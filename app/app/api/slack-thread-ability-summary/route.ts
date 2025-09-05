import { type NextRequest, NextResponse } from 'next/server';

import {
  generateSlackThreadSummaryInput,
  processSlackThreadCriteriaWithCache,
} from '../../../lib/slack-thread-ability-summary';
import { getAllEvaluationCriteria } from '../../../lib/ability-summary-prompt';
import { BatchProcessor, retryWithBackoff } from '../../../lib/batch-processor';
import { saveSlackAbilitySummary, getSlackAbilitySummariesByUser, getSlackUserInfo } from '../../../lib/github-db';
import { calculateUserAbility } from '../../../lib/mle-logic';

export async function POST(request: NextRequest) {
  try {
    const { username, channelIds } = await request.json();

    if (!username) {
      return NextResponse.json({ error: 'usernameが必要です' }, { status: 400 });
    }

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return NextResponse.json({ error: 'channelIds配列が必要です' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
    }

    // ユーザー情報確認
    const slackUserInfo = await getSlackUserInfo(username);
    if (!slackUserInfo) {
      return NextResponse.json({ error: `Slackユーザーが見つかりません: ${username}` }, { status: 404 });
    }

    console.log(
      `🚀 Starting Slack thread ability summary generation for ${username} across ${channelIds.length} channels`,
    );

    // 1. 全評価基準 + 既存キャッシュ取得
    const allCriteria: string[] = getAllEvaluationCriteria();
    const cachedRows = await getSlackAbilitySummariesByUser(slackUserInfo.userId);
    const cachedMap = new Map<string, any>(
      cachedRows.map((r) => [
        r.criteria_name,
        {
          criteria_name: r.criteria_name,
          evaluation_level: r.ability_score,
          summary: r.summary_text,
          channel_ids: r.channel_ids,
          cached: true,
        },
      ]),
    );

    // チャンネルが一致するキャッシュのみ使用
    const validCachedMap = new Map<string, any>();
    for (const [criteriaName, cached] of cachedMap) {
      const cachedChannelIds = cached.channel_ids.sort();
      const requestChannelIds = channelIds.slice().sort();
      if (JSON.stringify(cachedChannelIds) === JSON.stringify(requestChannelIds)) {
        validCachedMap.set(criteriaName, cached);
      }
    }

    const missingCriteria = allCriteria.filter((c) => !validCachedMap.has(c));

    if (missingCriteria.length === 0) {
      // 全てキャッシュ済み
      return NextResponse.json({
        success: true,
        username,
        channelIds,
        summary: allCriteria.map((c) => validCachedMap.get(c)).filter(Boolean),
        totalCriteria: allCriteria.length,
        processedCriteria: 0,
        fromCache: true,
      });
    }

    // 2. 各基準を処理する関数
    const processCriteria = async (criteriaNameInput: any) => {
      const criteriaName = String(criteriaNameInput);
      console.log(`🔄 Generating Slack thread input data for ${criteriaName}...`);

      const inputData = await generateSlackThreadSummaryInput(username, criteriaName, channelIds);
      if (!inputData) {
        console.log(`⏭️ Skipping ${criteriaName} - no Slack thread evaluation data`);
        return null;
      }

      console.log(`🔄 Calling cached API for Slack thread ${criteriaName} (input length: ${inputData.length})...`);
      const result = await processSlackThreadCriteriaWithCache(username, criteriaName, channelIds, apiKey, inputData);

      if (!result) {
        console.error(`❌ No result for Slack thread ${criteriaName}`);
        return null;
      }

      const response = result.response;
      const text = response.text();

      if (!text) {
        console.error(`❌ No response text for Slack thread ${criteriaName}`);
        return null;
      }

      console.log(`🔄 Parsing response for Slack thread ${criteriaName} (response length: ${text.length})...`);

      // JSONを解析
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const raw = jsonMatch ? jsonMatch[0] : text;
        const parsed = JSON.parse(raw) || {};

        // ability を必ず MLE で再計算し正とする
        let abilityScore = 0;
        try {
          const ability = await calculateUserAbility(
            criteriaName,
            undefined,
            undefined,
            username,
            'slack-thread',
            channelIds,
          );
          abilityScore = ability.ability;

          await saveSlackAbilitySummary({
            userId: slackUserInfo.userId,
            criteriaName,
            abilityScore,
            summaryText: parsed.summary || parsed.summary_text || '',
            channelIds,
          });
        } catch (e) {
          console.error('Failed to save Slack thread ability summary:', e);
        }

        console.log(`✅ Slack thread ${criteriaName} completed and saved`);
        return {
          criteria_name: criteriaName,
          evaluation_level: abilityScore,
          summary: parsed.summary || parsed.summary_text || '',
          channel_ids: channelIds,
          cached: false,
        };
      } catch (parseError) {
        console.error(`❌ Failed to parse JSON for Slack thread ${criteriaName}:`, parseError);
        console.log(`Raw response for Slack thread ${criteriaName}:`, text.substring(0, 300));
        return null;
      }
    };

    // 3. バッチ処理で全基準を処理
    const batchProcessor = new BatchProcessor({
      batchSize: 2,
      batchDelayMs: 3000,
      itemTimeoutMs: 3 * 60 * 1000, // 3分
      batchTimeoutMs: 5 * 60 * 1000, // 5分
      concurrentBatches: 2, // 複数バッチ並行実行
    });

    const successfulResults = await batchProcessor.processBatches(
      missingCriteria,
      processCriteria,
      (criteriaName) => String(criteriaName),
      'slack-thread-criteria',
    );

    console.log(
      `✅ Slack thread ability summary completed: newly processed ${successfulResults.length}, cached ${validCachedMap.size}, total ${allCriteria.length}`,
    );

    if (successfulResults.length === 0 && validCachedMap.size === 0) {
      return NextResponse.json(
        {
          error: '指定されたユーザーのSlackスレッド評価データが見つかりません',
          details: 'いずれの評価基準についても、MLE計算に必要なスレッド評価データが存在しません',
        },
        { status: 404 },
      );
    }

    // 最終まとめ: 元の順序で並べる
    const newMap = new Map<string, any>();
    for (const r of successfulResults as any[]) {
      if (r && (r as any).criteria_name) newMap.set((r as any).criteria_name, r);
    }
    const finalList = allCriteria.map((c) => newMap.get(c) || validCachedMap.get(c)).filter(Boolean);

    return NextResponse.json({
      success: true,
      username,
      channelIds,
      summary: finalList,
      totalCriteria: allCriteria.length,
      processedCriteria: successfulResults.length,
      cachedCount: validCachedMap.size,
    });
  } catch (error: unknown) {
    console.error('Slack thread ability summary API Error:', error);
    const err = error as Error;
    let errorMessage = 'Slackスレッド能力サマリー生成でエラーが発生しました';
    if (err instanceof Error) {
      errorMessage = `Slackスレッド能力サマリー生成エラー: ${err.message}`;
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
