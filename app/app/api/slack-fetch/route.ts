import { NextRequest, NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { BatchProcessor } from '@/lib/batch-processor';
import { saveSlackMessage, saveSlackUserInfo, saveSlackMessagesBulk } from '@/lib/github-db';

interface SlackMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  reply_count?: number;
  type?: string;
  files?: any[];
  attachments?: any[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRateLimit<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.data?.error === 'ratelimited') {
      const retryAfter = parseInt(e?.data?.retry_after ?? '2', 10) * 1000;
      const wait = Math.min(60000, retryAfter * attempt);
      console.warn(`Rate limited. Waiting ${wait}ms (attempt ${attempt})`);
      await sleep(wait);
      return withRateLimit(fn, attempt + 1);
    }
    throw e;
  }
}

export async function POST(request: NextRequest) {
  const token = process.env.SLACK_BOT_TOKEN;
  const {
    channelId,
    includeThreads = true,
    maxHistoryPages = 1000,
    maxThreadPages = 200,
    threadConcurrency = 5,
    threadBatchSize = 15,
    threadBatchDelayMs = 800,
  } = await request.json().catch(() => ({}));

  if (!token || !channelId) {
    return NextResponse.json({ error: 'tokenとchannelIdが必要です' }, { status: 400 });
  }

  const client = new WebClient(token);
  const history: SlackMessage[] = [];
  let cursor: string | undefined;
  let pages = 0;

  try {
    // 履歴取得 (ページネーション)
    do {
      pages++;
      if (pages > maxHistoryPages) {
        console.warn('maxHistoryPages reached');
        break;
      }
      const res: any = await withRateLimit(() =>
        client.conversations.history({ channel: channelId, limit: 1000, cursor }),
      );
      if (res.messages?.length) history.push(...(res.messages as SlackMessage[]));
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);

    const map = new Map<string, SlackMessage>();
    for (const m of history) if (!map.has(m.ts)) map.set(m.ts, m);
    const baseMessages = Array.from(map.values());

    // スレッド root (ts===thread_ts & reply_count>0)
    const threadRoots = baseMessages.filter((m) => m.thread_ts && m.thread_ts === m.ts && (m.reply_count ?? 0) > 0);

    // スレッド返信取得 (BatchProcessor 利用)
    let repliesCollected: SlackMessage[] = [];
    if (includeThreads && threadRoots.length) {
      const batchProcessor = new BatchProcessor<SlackMessage, SlackMessage[]>({
        batchSize: threadBatchSize,
        batchDelayMs: threadBatchDelayMs,
        concurrentBatches: Math.max(1, threadConcurrency),
      });

      const replyGroups = await batchProcessor.processBatches(
        threadRoots,
        async (root) => {
          const collected: SlackMessage[] = [];
          let tCursor: string | undefined;
          let tPages = 0;
          do {
            tPages++;
            if (tPages > maxThreadPages) break;
            try {
              const threadRes: any = await withRateLimit(() =>
                client.conversations.replies({
                  channel: channelId,
                  ts: root.thread_ts!,
                  limit: 1000,
                  cursor: tCursor,
                }),
              );
              const msgs = (threadRes.messages as SlackMessage[] | undefined) || [];
              for (const r of msgs) if (r.ts !== root.ts) collected.push(r);
              tCursor = threadRes.response_metadata?.next_cursor || undefined;
            } catch (e) {
              console.error('Thread fetch failed', root.thread_ts, e);
              break;
            }
          } while (tCursor);
          return collected;
        },
        (root) => root.thread_ts || root.ts,
        'threadRoots',
      );
      // フラット化
      repliesCollected = replyGroups.flat();
    }

    // 結合 + フィルタ
    const combined = [...baseMessages, ...repliesCollected];
    const filtered = combined.filter((m) => {
      if (!(m.type === 'message' || m.type === undefined)) return false;
      if (m.bot_id) return false;
      const hasText = typeof m.text === 'string' && m.text.trim() !== '';
      const hasFiles = Array.isArray(m.files) && m.files.length > 0;
      const hasAttachments = Array.isArray(m.attachments) && m.attachments.length > 0;
      const isFileShare = m.subtype === 'file_share';
      return hasText || hasFiles || hasAttachments || isFileShare;
    });

    filtered.sort((a, b) => (a.ts < b.ts ? -1 : 1));

    // メッセージに登場したユーザーだけでプロフィール取得
    const messageUserIds = Array.from(new Set(filtered.map((m) => m.user).filter(Boolean))) as string[];
    const allUserIds = Array.from(new Set<string>(messageUserIds.filter(Boolean)))
      // ボット/アプリユーザーは除外
      .filter((id) => typeof id === 'string' && (id.startsWith('U') || id.startsWith('W')));

    // プロフィールまとめ取得（常に users.list を全ページ取得し、足りないIDのみ users.info で補完）
    if (allUserIds.length) {
      try {
        const lookup = new Map<string, any>();
        let uCursor: string | undefined;
        let uPages = 0;
        do {
          uPages++;
          if (uPages > 100) break; // セーフガード
          const listResp: any = await withRateLimit(() => client.users.list({ limit: 200, cursor: uCursor } as any));
          const members: any[] = listResp.members || [];
          for (const m of members) lookup.set(m.id, m);
          uCursor = listResp.response_metadata?.next_cursor || undefined;
        } while (uCursor);

        const missing: string[] = [];
        for (const uid of allUserIds) {
          const m = lookup.get(uid);
          if (!m) {
            missing.push(uid);
            continue;
          }
          await saveSlackUserInfo(
            uid,
            m.real_name || m.profile?.real_name || null,
            m.profile?.display_name || null,
          ).catch((e) => console.error('Failed save user(list)', uid, e));
        }

        if (missing.length) {
          console.warn(`users.listで見つからないユーザー ${missing.length} 件。users.infoで補完します。`);
          const userBatch = new BatchProcessor<string, boolean>({ batchSize: 5, batchDelayMs: 300 });
          await userBatch.processBatches(
            missing,
            async (uid) => {
              try {
                const r = await withRateLimit(() => client.users.info({ user: uid }));
                const u = (r as any)?.user;
                if (u) {
                  await saveSlackUserInfo(
                    uid,
                    u.real_name || u.profile?.real_name || null,
                    u.profile?.display_name || null,
                  );
                }
                return true;
              } catch (e) {
                console.warn('users.info失敗', uid, e);
                return false;
              }
            },
            (uid) => uid,
            'userProfilesFallback',
          );
        }
      } catch (e) {
        console.warn('ユーザープロフィール一括取得失敗 (継続)', e);
      }
    }

    // メッセージ保存（1トランザクションで高速化）
    const rows = filtered.map((msg) => ({
      messageTs: msg.ts,
      threadTs: msg.thread_ts || null,
      userId: msg.user || '',
      text: msg.text || '',
      channelId,
      postedAt: new Date(Math.floor(parseFloat(msg.ts) * 1000)).toISOString(),
      replyCount: msg.reply_count || 0,
    }));
    try {
      console.log(`Saving ${rows.length} messages via transactional bulk upsert...`);
      await saveSlackMessagesBulk(rows, { chunkSize: 1000 });
      console.log('All messages have been saved.');
    } catch (e) {
      console.error('Bulk save failed; falling back to per-item...', e);
      for (const r of rows) {
        try {
          await saveSlackMessage(r.messageTs, r.threadTs, r.userId, r.text, r.channelId, r.postedAt, r.replyCount);
        } catch (err) {
          console.error('Fallback save failed', r.messageTs, err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      channelId,
      pagesFetched: pages,
      totalRaw: history.length,
      threadRoots: threadRoots.length,
      repliesFetched: repliesCollected.length,
      totalFiltered: filtered.length,
      includeThreads,
      messages: filtered,
    });
  } catch (error: any) {
    console.error('Error fetching Slack messages:', error);
    return NextResponse.json(
      { error: 'Slackメッセージの取得中にエラーが発生しました', detail: error?.message },
      { status: 500 },
    );
  }
}
