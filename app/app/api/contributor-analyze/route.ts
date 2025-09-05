import { GoogleGenerativeAI } from '@google/generative-ai';
import { type NextRequest, NextResponse } from 'next/server';
import { API_CONSTANTS, GEMINI_CONSTANTS } from '../../../config/constants';
import type { BatchItemInput } from '../../../types/evaluation';
import {
  formatAuthorDataForLLM,
  generateCachedSystemPrompt,
  generateEvaluationPrompt,
  generateUserPromptForItem,
  parseEvaluationResponse,
  parseEvaluationResponseWithPredictions,
} from '../../../lib/evaluation-formatter';
import {
  getAuthorDataForEvaluation,
  getInvolvedIssues,
  getInvolvedPullRequests,
  getMaxScorePredictions,
  saveAuthorEvaluation,
  saveItemEvaluation,
  saveMaxScorePrediction,
} from '../../../lib/github-db';
import { generateMaxScoreSystemPromptWithCache, predictMaxScores } from '../../../lib/max-score-prediction';
import { BatchProcessor, retryWithBackoff } from '../../../lib/batch-processor';

// リトライ機能は batch-processor.ts から import

interface BatchItem {
  type: 'pull_request' | 'issue';
  data: {
    id: number;
    pr_number?: number;
    issue_number?: number;
    title: string;
    body: string;
    comments: Array<{
      body: string;
      user_name: string;
    }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    const { repositorySlug, username, evaluateIndividually = true } = await request.json();

    if (!repositorySlug || !username) {
      return NextResponse.json({ error: 'repositorySlugとusernameが必要です' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
    }

    //　個別評価の場合
    if (evaluateIndividually) {
      return await evaluateIndividualItems(repositorySlug, username, apiKey);
    }

    // 既存のコントリビューターデータを取得
    const authorData = await getAuthorDataForEvaluation(repositorySlug, username);

    if (!authorData.pullRequests.length && !authorData.issues.length) {
      return NextResponse.json({ error: '指定されたユーザーのデータが見つかりません' }, { status: 404 });
    }

    // LLM評価用のプロンプトを生成
    const formattedData = formatAuthorDataForLLM({
      repositorySlug,
      username,
      pullRequests: authorData.pullRequests,
      issues: authorData.issues,
    });

    const prompt = generateEvaluationPrompt(formattedData);
    console.log(prompt);

    // Gemini APIで評価実行（リトライ機能付き）
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_CONSTANTS.MODEL_NAME });

    const result = await retryWithBackoff(async () => {
      return await model.generateContent(prompt);
    });
    const response = result.response;
    const text = response.candidates?.[0]?.content.parts[0]?.text;

    if (!text) {
      return NextResponse.json({ error: 'Geminiから評価結果を取得できませんでした' }, { status: 500 });
    }

    const evaluation = parseEvaluationResponse(text);
    if (!evaluation) {
      console.error('LLMからの応答の解析に失敗しました:', '元のテキスト:', text);
      return NextResponse.json({ error: 'LLMからの応答の解析に失敗しました' }, { status: 500 });
    }

    try {
      await saveAuthorEvaluation(repositorySlug, username, evaluation);
      console.log('評価結果をデータベースに保存しました:', evaluation);
    } catch (dbError) {
      console.error('評価結果のデータベースへの保存に失敗しました:', dbError);
      return NextResponse.json({ error: '評価結果のデータベースへの保存に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      evaluation: text,
    });
  } catch (error) {
    console.error('Evaluation API Error:', error);

    let errorMessage = '評価処理でエラーが発生しました';

    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        errorMessage = 'APIキーが無効または権限がありません';
      } else if (error.message.includes('quota')) {
        errorMessage = 'APIクォータを超過しました';
      } else if (error.message.includes('billing')) {
        errorMessage = '課金が有効になっていません';
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * 指定されたコントリビューターの全PR/Issueを別々に評価する
 */
async function evaluateIndividualItems(repositorySlug: string, username: string, apiKey: string) {
  try {
    console.log(`🚀 Starting parallel single-stage evaluation...`);

    // 1. コントリビューターの関与したPR/Issue（コメントのみも含む）をデータベースから取得
    const pullRequests = await getInvolvedPullRequests(repositorySlug, username);
    const issues = await getInvolvedIssues(repositorySlug, username);

    const allItems = [
      ...pullRequests.map((pr) => ({ type: 'pull_request' as const, data: pr })),
      ...issues.map((issue) => ({ type: 'issue' as const, data: issue })),
    ];

    const totalItems = allItems.length;
    if (totalItems === 0) {
      return NextResponse.json({ error: '指定されたユーザーのPR/Issueが見つかりません' }, { status: 404 });
    }

    console.log(`🔄 Processing ${totalItems} items with batch evaluation...`);

    // 2. アイテム処理関数
    const processItem = async (item: BatchItem) => {
      try {
        const itemNumber = item.type === 'pull_request' ? item.data.pr_number : item.data.issue_number;
        console.log(`📊 Evaluating ${item.type} #${itemNumber}...`);

        const evaluation = await processSingleItemEvaluation(item, repositorySlug, username, apiKey);

        if (evaluation) {
          // データベース保存
          await saveEvaluationResults(item.type, item.data.id, repositorySlug, username, evaluation);
          console.log(`✅ ${item.type} #${itemNumber} evaluation completed`);

          return {
            type: item.type,
            id: item.data.id,
            number: itemNumber,
            title: item.data.title,
            success: true,
            evaluation,
            completeness: 'complete',
          };
        } else {
          console.warn(`⚠️ ${item.type} #${itemNumber} evaluation incomplete`);
          return {
            type: item.type,
            id: item.data.id,
            number: itemNumber,
            title: item.data.title,
            success: false,
            error: '評価が不完全です',
            completeness: 'none',
          };
        }
      } catch (itemError: any) {
        const itemNumber = item.type === 'pull_request' ? item.data.pr_number : item.data.issue_number;
        console.error(`❌ ${item.type} #${itemNumber} evaluation failed:`, itemError?.message || itemError);

        return {
          type: item.type,
          id: item.data.id,
          number: itemNumber,
          title: item.data.title,
          success: false,
          error: `評価エラー: ${itemError?.message || itemError}`,
          completeness: 'error',
        };
      }
    };

    // 3. バッチ処理で評価を実行
    const batchProcessor = new BatchProcessor({
      batchSize: API_CONSTANTS.DEFAULT_BATCH_SIZE,
      batchDelayMs: API_CONSTANTS.BATCH_DELAY_MS,
      itemTimeoutMs: 2 * 60 * 1000, // 2分
      batchTimeoutMs: 10 * 60 * 1000, // 10分
      concurrentBatches: API_CONSTANTS.CONCURRENT_REQUESTS, // 複数バッチ並行実行
    });

    const allResults = await batchProcessor.processBatches(
      allItems,
      processItem,
      (item) => `${item.type}#${item.type === 'pull_request' ? item.data.pr_number : item.data.issue_number}`,
      'evaluation items',
    );

    // 4. 結果サマリーを作成
    const successCount = allResults.filter((r) => r.success).length;
    const failureCount = allResults.filter((r) => !r.success).length;
    const completeCount = allResults.filter((r) => r.completeness === 'complete').length;

    console.log(`🎉 Parallel evaluation completed: ${successCount}/${totalItems} successful`);

    return NextResponse.json({
      success: true,
      mode: 'parallel_single_stage',
      summary: {
        total: totalItems,
        successful: successCount,
        failed: failureCount,
        complete_evaluations: completeCount,
        repository: repositorySlug,
        author: username,
        batch_size: API_CONSTANTS.DEFAULT_BATCH_SIZE,
      },
      results: allResults,
    });
  } catch (error) {
    console.error('Parallel evaluation error:', error);
    return NextResponse.json(
      {
        error: '並列評価処理でエラーが発生しました: ' + (error instanceof Error ? error.message : String(error)),
      },
      { status: 500 },
    );
  }
}

/**
 * 単一アイテムの評価を処理
 */
async function processSingleItemEvaluation(
  item: BatchItem,
  repositorySlug: string,
  username: string,
  apiKey: string,
): Promise<any> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_CONSTANTS.MODEL_NAME,
    });

    // システムプロンプト取得
    const systemPrompt = generateCachedSystemPrompt();

    const itemData = {
      prNumber: item.type === 'pull_request' ? item.data.pr_number : undefined,
      prTitle: item.type === 'pull_request' ? item.data.title : undefined,
      prBody: item.type === 'pull_request' ? (item.data.body || '').slice(0, 2000) : undefined,
      issueNumber: item.type === 'issue' ? item.data.issue_number : undefined,
      issueTitle: item.type === 'issue' ? item.data.title : undefined,
      issueBody: item.type === 'issue' ? (item.data.body || '').slice(0, 2000) : undefined,
      comments:
        item.data.comments?.map((c) => ({
          body: c.body || '',
          userLogin: c.user_name || '',
        })) || [],
    };

    // 満点予測データを取得（なければ即時に推定・保存してSlack形式へ揃える）
    const itemNumber = item.type === 'pull_request' ? item.data.pr_number : item.data.issue_number;
    let maxScorePredictions = await getMaxScorePredictions(item.type, itemNumber, repositorySlug);

    if (!maxScorePredictions || Object.keys(maxScorePredictions).length === 0) {
      try {
        const cachedContent = await generateMaxScoreSystemPromptWithCache(apiKey);
        const predictionInput =
          item.type === 'pull_request'
            ? {
                prNumber: item.data.pr_number,
                prTitle: item.data.title,
                prBody: (item.data.body || '').slice(0, 4000),
                repository: repositorySlug,
              }
            : {
                issueNumber: item.data.issue_number,
                issueTitle: item.data.title,
                issueBody: (item.data.body || '').slice(0, 4000),
                repository: repositorySlug,
              };

        const pred = await predictMaxScores(apiKey, item.type, predictionInput, cachedContent);
        if (pred && pred.predictions?.length) {
          for (const p of pred.predictions) {
            await saveMaxScorePrediction(item.type, itemNumber!, repositorySlug, username, p.criteria, {
              predictedMaxScore: p.predictedMaxScore,
              reasoning: p.reasoning,
            });
          }
          // 直近の保存結果を使ってマップを作る
          maxScorePredictions = Object.fromEntries(pred.predictions.map((p) => [p.criteria, p.predictedMaxScore]));
        }
      } catch (e) {
        console.warn('Max score prediction inline step failed; continue without predictions.', e);
        maxScorePredictions = {};
      }
    }

    const userPrompt = generateUserPromptForItem(item.type, itemData, maxScorePredictions);
    const fullPrompt = systemPrompt + '\n\n' + userPrompt;

    // リトライ機能付きでAPI呼び出し
    const result = await retryWithBackoff(async () => {
      return await model.generateContent(fullPrompt);
    });
    const response = result.response;
    const text = response.text();

    if (text) {
      const evaluation = parseEvaluationResponseWithPredictions(text, maxScorePredictions);
      return evaluation;
    } else {
      console.warn(`No response text for ${item.type} #${item.data.pr_number || item.data.issue_number}`);
      return null;
    }
  } catch (error) {
    console.error(`Single item evaluation error:`, error);
    return null;
  }
}

async function saveEvaluationResults(
  itemType: 'pull_request' | 'issue',
  itemId: number,
  repositorySlug: string,
  authorUsername: string,
  evaluation: {
    evaluations: Array<{
      criteria: string;
      level: number;
      reasoning: string;
      evidence: string | string[];
      evaluable?: boolean;
      surpriseFlag?: boolean;
      incidentFlag?: boolean;
    }>;
  },
) {
  const promises = [];

  for (const evalItem of evaluation.evaluations) {
    promises.push(
      saveItemEvaluation(
        itemType,
        itemId,
        repositorySlug,
        authorUsername,
        evalItem.criteria,
        evalItem.level,
        evalItem.reasoning,
        Array.isArray(evalItem.evidence) ? evalItem.evidence.join(', ') : evalItem.evidence || '',
        evalItem.evaluable ?? true,
        evalItem.surpriseFlag ?? false,
        evalItem.incidentFlag ?? false,
      ),
    );
  }

  await Promise.all(promises);
}
