import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { API_CONSTANTS, GEMINI_CONSTANTS } from '@/config/constants';
import {
  generateSlackThreadEvaluationPrompt,
  generateSlackThreadMaxScorePredictionPrompt,
} from '@/lib/slack-thread-evaluation';
import { parseEvaluationResponse } from '@/lib/evaluation-formatter';
import { parseMaxScorePredictionResponse } from '@/lib/max-score-prediction';
import { BatchProcessor, retryWithBackoff } from '@/lib/batch-processor';
import {
  getSlackUserInfo,
  getSlackMessagesByThread,
  getSlackThreadsByChannel,
  getSlackThreadsByChannelAndUser,
  saveSlackThreadUserEvaluations,
  saveSlackThreadMaxScorePrediction,
  getSlackThreadMaxScorePredictions,
} from '@/lib/github-db';

export async function POST(request: NextRequest) {
  try {
    const {
      username,
      channelIds,
      threadTs,
      channelId,
    }: {
      username: string;
      channelIds?: string[];
      threadTs?: string;
      channelId?: string;
    } = await request.json();

    if (!username) {
      return NextResponse.json({ error: 'usernameが必要です' }, { status: 400 });
    }

    // 特定スレッド評価 vs 複数チャンネルのスレッド評価
    if (threadTs && channelId) {
      return await evaluateSpecificThread(username, channelId, threadTs);
    } else if (channelIds && channelIds.length > 0) {
      return await evaluateThreadsInChannels(username, channelIds);
    } else {
      return NextResponse.json(
        {
          error: '特定スレッド評価には threadTs と channelId、複数チャンネル評価には channelIds が必要です',
        },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error('Slack thread evaluation error:', error);
    return NextResponse.json(
      { error: 'Slackスレッド評価エラー: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}

// 特定スレッドの評価
async function evaluateSpecificThread(username: string, channelId: string, threadTs: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
  }

  console.log(`🚀 Starting thread evaluation for ${username} in thread ${threadTs} (channel: ${channelId})`);

  // ユーザー情報取得
  const slackUserInfo = await getSlackUserInfo(username);
  if (!slackUserInfo) {
    return NextResponse.json({ error: `Slackユーザーが見つかりません: ${username}` }, { status: 404 });
  }

  // スレッドメッセージ取得
  const threadMessages = await getSlackMessagesByThread(channelId, threadTs);
  if (threadMessages.length === 0) {
    return NextResponse.json({ error: 'スレッドにメッセージが見つかりません' }, { status: 404 });
  }

  // ユーザーがスレッドに参加しているかチェック
  const userParticipates = threadMessages.some((m) => m.userId === slackUserInfo.userId);
  if (!userParticipates) {
    return NextResponse.json({ error: 'ユーザーはこのスレッドに参加していません' }, { status: 404 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_CONSTANTS.MODEL_NAME });

  try {
    // 1. 最高点予測
    console.log('📊 Predicting max scores for thread...');

    const maxScorePrompt = generateSlackThreadMaxScorePredictionPrompt(
      channelId,
      threadTs,
      threadMessages.map((m) => ({
        userId: m.userId,
        text: m.text,
        postedAt: m.postedAt,
      })),
    );

    const maxScoreResult = await model.generateContent(maxScorePrompt);
    const maxScoreText = maxScoreResult.response?.text?.() ?? '';

    let maxScorePredictions: { [criteriaName: string]: number } = {};
    if (maxScoreText) {
      const parsed = parseMaxScorePredictionResponse(maxScoreText);
      if (parsed && parsed.predictions) {
        // 予測結果をデータベースに保存
        for (const prediction of parsed.predictions) {
          await saveSlackThreadMaxScorePrediction({
            threadTs,
            channelId,
            criteriaName: prediction.criteria,
            predictedMaxScore: prediction.predictedMaxScore,
            reasoning: prediction.reasoning,
          });
          maxScorePredictions[prediction.criteria] = prediction.predictedMaxScore;
        }
        console.log('✅ Max score predictions saved');
      }
    }

    // 2. ユーザー評価
    console.log('📊 Evaluating user performance in thread...');

    const evaluationPrompt = generateSlackThreadEvaluationPrompt(
      username,
      channelId,
      threadTs,
      threadMessages.map((m) => ({
        userId: m.userId,
        text: m.text,
        postedAt: m.postedAt,
      })),
      maxScorePredictions, // 最高点予測を渡す
    );

    const evaluationResult = await model.generateContent(evaluationPrompt);
    const evaluationText = evaluationResult.response?.text?.() ?? '';

    if (!evaluationText) {
      return NextResponse.json({ error: 'LLMから評価結果を取得できませんでした' }, { status: 500 });
    }

    const evaluation = parseEvaluationResponse(evaluationText);
    if (!evaluation || !evaluation.evaluations?.length) {
      console.error('評価レスポンスの解析に失敗:', evaluationText);
      return NextResponse.json({ error: '評価レスポンスの解析に失敗しました' }, { status: 500 });
    }

    // データベースに保存
    await saveSlackThreadUserEvaluations(
      threadTs,
      channelId,
      username,
      evaluation.evaluations
        .filter((e) => e.level !== null)
        .map((e) => ({
          ...e,
          level: e.level as number,
        })),
    );

    console.log('✅ Thread evaluation completed and saved');

    return NextResponse.json({
      success: true,
      username,
      channelId,
      threadTs,
      messageCount: threadMessages.length,
      maxScorePredictions,
      evaluation: evaluation,
      rawEvaluationText: evaluationText,
    });
  } catch (error) {
    console.error('❌ Thread evaluation failed:', error);
    return NextResponse.json(
      { error: `スレッド評価エラー: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

// 複数チャンネルのスレッド評価（バッチ処理使用）
async function evaluateThreadsInChannels(username: string, channelIds: string[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
  }

  console.log(`🚀 Starting batch thread evaluation for ${username} across ${channelIds.length} channels`);

  const slackUserInfo = await getSlackUserInfo(username);
  if (!slackUserInfo) {
    return NextResponse.json({ error: `Slackユーザーが見つかりません: ${username}` }, { status: 404 });
  }

  // 全チャンネルからユーザー参加スレッドを収集
  const allThreadsToEvaluate: Array<{
    channelId: string;
    threadTs: string;
    messageCount: number;
    firstMessage: string;
  }> = [];

  for (const channelId of channelIds) {
    try {
      console.log(`📊 Collecting threads from channel ${channelId}...`);

      // ユーザーが発言している全スレッドを直接取得
      const userThreads = await getSlackThreadsByChannelAndUser(channelId, slackUserInfo.userId);

      // 制限なしで全スレッドを対象とする（必要に応じて制限可能）
      const threadsToAdd = userThreads.map((thread) => ({
        channelId,
        threadTs: thread.threadTs,
        messageCount: thread.messageCount,
        userMessageCount: thread.userMessageCount,
        firstMessage: thread.firstMessage,
      }));

      allThreadsToEvaluate.push(...threadsToAdd);
      console.log(`Found ${userThreads.length} threads with user messages in channel ${channelId}`);
    } catch (channelError) {
      console.error(`❌ Failed to collect threads from channel ${channelId}:`, channelError);
    }
  }

  if (allThreadsToEvaluate.length === 0) {
    return NextResponse.json({ error: 'ユーザーが参加するスレッドが見つかりません' }, { status: 404 });
  }

  console.log(`🎯 Total threads to evaluate: ${allThreadsToEvaluate.length}`);

  // バッチ処理でスレッド評価を実行
  const batchProcessor = new BatchProcessor({
    batchSize: API_CONSTANTS.DEFAULT_BATCH_SIZE || 3,
    batchDelayMs: API_CONSTANTS.BATCH_DELAY_MS || 2000,
    itemTimeoutMs: 3 * 60 * 1000, // 3分
    batchTimeoutMs: 10 * 60 * 1000, // 10分
    concurrentBatches: API_CONSTANTS.CONCURRENT_REQUESTS || 2,
  });

  const processThread = async (thread: {
    channelId: string;
    threadTs: string;
    messageCount: number;
    userMessageCount?: number;
    firstMessage: string;
  }) => {
    try {
      console.log(`🧵 Processing thread ${thread.threadTs} in channel ${thread.channelId}...`);

      // スレッドの評価を実行（最高点予測 + ユーザー評価）
      const result = await evaluateSpecificThreadInternal(
        username,
        thread.channelId,
        thread.threadTs,
        slackUserInfo.userId,
        apiKey,
      );

      return {
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        success: true,
        messageCount: thread.messageCount,
        userMessageCount: thread.userMessageCount || 0,
        firstMessage: thread.firstMessage.slice(0, 100) + '...',
        evaluation: result,
      };
    } catch (error) {
      console.error(`❌ Thread ${thread.threadTs} evaluation failed:`, error);
      return {
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        success: false,
        messageCount: thread.messageCount,
        userMessageCount: thread.userMessageCount || 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  // バッチ処理でスレッド評価実行
  const threadResults = await batchProcessor.processBatches(
    allThreadsToEvaluate,
    processThread,
    (thread) => `${thread.channelId}/${thread.threadTs}`,
    'threads',
  );

  // チャンネル別に結果を整理
  const channelResultsMap = new Map<string, any>();

  for (const channelId of channelIds) {
    channelResultsMap.set(channelId, {
      channelId,
      success: true,
      threadCount: 0,
      successfulThreads: 0,
      threads: [],
    });
  }

  // 結果をチャンネル別に分類
  for (const result of threadResults) {
    const channelResult = channelResultsMap.get(result.channelId);
    if (channelResult) {
      channelResult.threads.push(result);
      channelResult.threadCount++;
      if (result.success) {
        channelResult.successfulThreads++;
      }
    }
  }

  const channelResults = Array.from(channelResultsMap.values());
  const successfulChannels = channelResults.filter((r) => r.successfulThreads > 0).length;
  const totalThreadsEvaluated = threadResults.filter((r) => r.success).length;

  console.log(
    `🎉 Batch thread evaluation completed: ${totalThreadsEvaluated}/${allThreadsToEvaluate.length} threads successful`,
  );

  return NextResponse.json({
    success: true,
    username,
    channelIds,
    totalChannels: channelIds.length,
    successfulChannels,
    totalThreadsCollected: allThreadsToEvaluate.length,
    totalThreadsEvaluated,
    batchInfo: {
      batchSize: API_CONSTANTS.DEFAULT_BATCH_SIZE || 3,
      concurrentBatches: API_CONSTANTS.CONCURRENT_REQUESTS || 2,
    },
    results: channelResults,
  });
}

// 内部用の特定スレッド評価関数（リトライ機能付き）
async function evaluateSpecificThreadInternal(
  username: string,
  channelId: string,
  threadTs: string,
  userId: string,
  apiKey: string,
) {
  const threadMessages = await getSlackMessagesByThread(channelId, threadTs);

  if (threadMessages.length === 0) {
    throw new Error('スレッドにメッセージが見つかりません');
  }

  // ユーザーがスレッドに参加しているかチェック
  const userParticipates = threadMessages.some((m) => m.userId === userId);
  if (!userParticipates) {
    throw new Error('ユーザーはこのスレッドに参加していません');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_CONSTANTS.MODEL_NAME });

  const messageData = threadMessages.map((m) => ({
    userId: m.userId,
    text: m.text,
    postedAt: m.postedAt,
  }));

  let maxScorePredictions: { [criteriaName: string]: number } = {};

  // 1. 最高点予測（リトライ付き）
  try {
    const maxScorePrompt = generateSlackThreadMaxScorePredictionPrompt(channelId, threadTs, messageData);

    const maxScoreResult = await retryWithBackoff(
      async () => {
        const result = await model.generateContent(maxScorePrompt);
        if (!result || !result.response) {
          throw new Error('Empty response from Gemini API for max score prediction');
        }
        return result;
      },
      3,
      1500,
    ); // 最高点予測は3回リトライ、1.5秒から開始

    const maxScoreText = maxScoreResult.response?.text?.() ?? '';

    if (maxScoreText) {
      const parsed = parseMaxScorePredictionResponse(maxScoreText);
      if (parsed && parsed.predictions) {
        // 予測結果をDBに保存
        const savePromises = parsed.predictions.map(async (prediction) => {
          try {
            await saveSlackThreadMaxScorePrediction({
              threadTs,
              channelId,
              criteriaName: prediction.criteria,
              predictedMaxScore: prediction.predictedMaxScore,
              reasoning: prediction.reasoning,
            });
            maxScorePredictions[prediction.criteria] = prediction.predictedMaxScore;
          } catch (saveError) {
            console.error(
              `Failed to save max score prediction for thread ${threadTs}, criteria ${prediction.criteria}:`,
              saveError,
            );
          }
        });

        await Promise.all(savePromises);
      }
    }
  } catch (maxScoreError: any) {
    console.warn(`⚠️ Max score prediction failed for thread ${threadTs}:`, maxScoreError?.message || maxScoreError);
    // 最高点予測が失敗しても評価は続行
  }

  // 2. ユーザー評価（リトライ付き）
  const evaluationPrompt = generateSlackThreadEvaluationPrompt(
    username,
    channelId,
    threadTs,
    messageData,
    maxScorePredictions, // 最高点予測を渡す
  );

  let evaluationText = '';
  try {
    const evaluationResult = await retryWithBackoff(
      async () => {
        const result = await model.generateContent(evaluationPrompt);
        if (!result || !result.response) {
          throw new Error('Empty response from Gemini API');
        }
        return result;
      },
      5,
      2000,
    ); // 最大5回リトライ、2秒から開始

    evaluationText = evaluationResult.response?.text?.() ?? '';

    if (!evaluationText) {
      throw new Error('LLMから評価結果を取得できませんでした');
    }
  } catch (apiError: any) {
    console.error(`API error for thread ${threadTs}:`, apiError);

    // APIエラーの種類に応じて適切なエラーメッセージを生成
    if (apiError.message?.includes('fetch failed') || apiError.message?.includes('network')) {
      throw new Error(`ネットワークエラー: Gemini APIへの接続に失敗しました`);
    } else if (apiError.message?.includes('quota') || apiError.message?.includes('limit')) {
      throw new Error(`API制限: リクエスト制限に達しました`);
    } else if (apiError.message?.includes('401') || apiError.message?.includes('unauthorized')) {
      throw new Error(`認証エラー: APIキーが無効または権限がありません`);
    } else {
      throw new Error(`API呼び出しエラー: ${apiError.message || 'Unknown error'}`);
    }
  }

  const evaluation = parseEvaluationResponse(evaluationText);
  if (!evaluation || !evaluation.evaluations?.length) {
    throw new Error('評価レスポンスの解析に失敗しました');
  }

  // データベースに保存
  await saveSlackThreadUserEvaluations(
    threadTs,
    channelId,
    username,
    evaluation.evaluations
      .filter((e) => e.level !== null)
      .map((e) => ({
        ...e,
        level: e.level as number,
      })),
  );

  return {
    ...evaluation,
    maxScorePredictions,
  };
}
