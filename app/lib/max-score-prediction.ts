import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_CONSTANTS, GEMINI_CONSTANTS } from '../config/constants';
import { getInvolvedPullRequestsBasicInfo, getInvolvedIssuesBasicInfo, saveMaxScorePrediction } from './github-db';
import { BatchProcessor, retryWithBackoff } from './batch-processor';

interface MaxScorePrediction {
  criteria: string;
  predictedMaxScore: number;
  reasoning: string;
}

interface ScorePredictionResult {
  itemType: 'pull_request' | 'issue';
  itemNumber: number;
  title: string;
  repository: string;
  predictions: MaxScorePrediction[];
}

// Cached Contentを管理するための変数
// { content: キャッシュオブジェクト, expiresAt: 期限(Epoch ms) }
let cachedSystemPrompt: { content: any; expiresAt: number } | null = null;
// 競合防止: 同時多発のキャッシュ生成を１つにまとめる
let creatingCachePromise: Promise<any> | null = null;

function readEvaluationCriteria(): string {
  try {
    const appRoot = process.cwd().includes('/app') ? process.cwd() : join(process.cwd(), 'app');
    const criteriaPath = join(appRoot, 'config', 'EVALUATION_CRITERIA.md');
    const content = readFileSync(criteriaPath, 'utf-8');
    return content;
  } catch (error) {
    console.error('Error reading evaluation criteria:', error);
    throw new Error('評価基準ファイルの読み込みに失敗しました');
  }
}

export async function generateMaxScoreSystemPromptWithCache(apiKey: string): Promise<any | null> {
  const TTL_SECONDS = API_CONSTANTS.CACHE_TTL_SECONDS || 3600;
  const now = Date.now();
  try {
    if (cachedSystemPrompt && cachedSystemPrompt.expiresAt > now) {
      return cachedSystemPrompt.content;
    }

    if (creatingCachePromise) {
      return creatingCachePromise;
    }

    const promptText = generateMaxScorePredictionPrompt();
    creatingCachePromise = Promise.resolve(promptText)
      .then((text) => {
        cachedSystemPrompt = {
          content: text,
          expiresAt: Date.now() + (TTL_SECONDS - 5) * 1000,
        };
        console.log('✅ In-memory system prompt cached');
        return text;
      })
      .finally(() => {
        creatingCachePromise = null;
      });

    return await creatingCachePromise;
  } catch (error) {
    console.error('Error generating system prompt:', error);
    return null;
  }
}

export function generateMaxScorePredictionPrompt(): string {
  const evaluationCriteria = readEvaluationCriteria();

  return `あなたは経験豊富なエンジニアリングマネージャーです。あなたの目的は、開発者の実際のパフォーマンス（コードの質やコメントなど）を評価することでは決してありません。
そうではなく、「もし仮に、理想的な開発者がこの課題に100%の力で取り組んだとしたら、各評価基準において最高で何点を獲得することが可能だったか」という、課題の理論上の満点を予測してください。

# 禁止事項

開発者の実際のコードやコメントの品質を評価・言及してはいけません。

「このPRでは〇〇が実践されている」といった、実行済みの内容を根拠にしてはいけません。

あなたの分析対象は、あくまで課題の「説明文」「目的」「背景」です。

# 評価基準

${evaluationCriteria}

# 満点予測の考え方

各評価基準について、Issue/PRの以下の要素を考慮して満点を予測してください：

## 評価要素
- **複雑さ**: 技術的難易度、影響範囲、実装の複雑さ
- **重要度**: 事業への影響、ユーザーへの価値、戦略的重要性
- **必要スキル**: 求められる技術力、リーダーシップ、調整力
- **影響範囲**: 個人タスク < チームタスク < 部門横断 < 全社的

## 満点レベル (1-4)
- **1点**: 基本的・簡単なタスク（個人で完結、定型的作業）
- **2点**: 標準的なタスク（チーム内調整、一般的な開発作業）
- **3点**: 複雑なタスク（部門横断、技術的挑戦、設計判断）
- **4点**: 非常に高度・困難なタスク（全社影響、革新的、高度な専門知識）

# 出力形式

以下のJSONフォーマットで出力してください：

\`\`\`json
{
  "predictions": [
    {
      "criteria": "評価基準名",
      "predictedMaxScore": 1-4の整数,
      "reasoning": "この満点を予測した詳細理由"
    }
  ]
}
\`\`\`

各評価基準について、PR/Issueの内容から客観的に満点を予測してください。`;
}

export function generateMaxScorePredictionUserPrompt(itemType: 'pull_request' | 'issue', itemData: any): string {
  const itemNumber = itemType === 'pull_request' ? itemData.prNumber : itemData.issueNumber;
  const itemTitle = itemType === 'pull_request' ? itemData.prTitle : itemData.issueTitle;
  const itemBody = itemType === 'pull_request' ? itemData.prBody : itemData.issueBody;

  let prompt = `# 満点予測対象データ

## ${itemType === 'pull_request' ? 'Pull Request' : 'Issue'} #${itemNumber}: ${itemTitle}

**内容:**
${itemBody || '内容なし'}


**重要**: 上記の${itemType === 'pull_request' ? 'Pull Request' : 'Issue'}データを分析し、各評価基準における満点を予測してください。必ず以下の形式のJSONで回答してください：

\`\`\`json
{
  "predictions": [
    {
      "criteria": "評価基準名",
      "predictedMaxScore": 1-4の整数,
      "reasoning": "予測理由"
    }
  ]
}
\`\`\`

predictions配列を必ず含めて回答してください。`;

  return prompt;
}

// 特定ユーザーの関与したアイテムの基本情報のみで満点予測を実行
export async function predictMaxScoresForUserBasicInfo(
  apiKey: string,
  repositoryName: string,
  username: string,
): Promise<ScorePredictionResult[]> {
  try {
    console.log(`🚀 Starting max score prediction for user ${username} in ${repositoryName} (basic info only)...`);

    // 1. ユーザーが関与したPRとIssueの基本情報のみを取得
    const [pullRequests, issues] = await Promise.all([
      getInvolvedPullRequestsBasicInfo(repositoryName, username),
      getInvolvedIssuesBasicInfo(repositoryName, username),
    ]);

    const allItems = [
      ...pullRequests.map((pr) => ({
        type: 'pull_request' as const,
        data: {
          prNumber: pr.pr_number,
          prTitle: pr.title,
          prBody: pr.body || '',
          repository: repositoryName,
        },
      })),
      ...issues.map((issue) => ({
        type: 'issue' as const,
        data: {
          issueNumber: issue.issue_number,
          issueTitle: issue.title,
          issueBody: issue.body || '',
          repository: repositoryName,
        },
      })),
    ];

    console.log(`Found ${allItems.length} items to predict (${pullRequests.length} PRs, ${issues.length} issues)`);

    if (allItems.length === 0) {
      return [];
    }

    // 2. システムプロンプトをキャッシュ
    const cachedContent = await generateMaxScoreSystemPromptWithCache(apiKey);

    // 3. より効率的な並列処理で満点予測
    const concurrentRequests = API_CONSTANTS.CONCURRENT_REQUESTS;
    const batchSize = API_CONSTANTS.MAX_SCORE_BATCH_SIZE;
    const results: ScorePredictionResult[] = [];

    // バッチを作成
    const batches = [];
    for (let i = 0; i < allItems.length; i += batchSize) {
      batches.push(allItems.slice(i, i + batchSize));
    }

    console.log(`Processing ${batches.length} prediction batches with ${concurrentRequests} concurrent requests...`);

    // 複数バッチを同時実行
    for (let i = 0; i < batches.length; i += concurrentRequests) {
      const concurrentBatches = batches.slice(i, i + concurrentRequests);

      const batchPromises = concurrentBatches.map(async (batchItems, batchIndex) => {
        const actualBatchNumber = i + batchIndex + 1;
        console.log(
          `Processing concurrent prediction batch ${actualBatchNumber}/${batches.length} with ${batchItems.length} items...`,
        );

        const itemPromises = batchItems.map(async (item) => {
          try {
            const itemNumber = item.type === 'pull_request' ? item.data.prNumber : item.data.issueNumber;
            console.log(`🔮 Predicting ${item.type} #${itemNumber}...`);

            const result = await predictMaxScores(apiKey, item.type, item.data, cachedContent);

            if (result) {
              // 予測結果をデータベースに保存
              const savePromises = result.predictions.map(async (prediction) => {
                try {
                  await saveMaxScorePrediction(
                    result.itemType,
                    result.itemNumber,
                    repositoryName,
                    username,
                    prediction.criteria,
                    {
                      predictedMaxScore: prediction.predictedMaxScore,
                      reasoning: prediction.reasoning,
                    },
                  );
                } catch (saveError) {
                  console.error(
                    `Failed to save prediction for ${result.itemType} #${result.itemNumber}, criteria: ${prediction.criteria}:`,
                    saveError,
                  );
                }
              });

              await Promise.all(savePromises);
              console.log(`✅ ${item.type} #${itemNumber} prediction completed and saved`);
              return result;
            } else {
              console.warn(`⚠️ ${item.type} #${itemNumber} prediction failed`);
              return null;
            }
          } catch (error) {
            const itemNumber = item.type === 'pull_request' ? item.data.prNumber : item.data.issueNumber;
            if (error instanceof Error) {
              console.error(`❌ ${item.type} #${itemNumber} prediction error:`, error.message);
            } else {
              console.error(`❌ ${item.type} #${itemNumber} prediction error (non-Error):`, error);
            }
            return null;
          }
        });

        try {
          // バッチ内のアイテムを並列実行
          return await Promise.all(itemPromises);
        } catch (batchError) {
          if (batchError instanceof Error) {
            console.error(`Concurrent prediction batch ${actualBatchNumber} processing failed:`, batchError.message);
          } else {
            console.error(
              `Concurrent prediction batch ${actualBatchNumber} processing failed (non-Error):`,
              batchError,
            );
          }
          return Array(batchItems.length).fill(null);
        }
      });

      try {
        // 複数バッチを並列実行
        const concurrentResults = await Promise.all(batchPromises);
        // 結果をフラットに展開し、nullを除外
        const validResults = concurrentResults.flat().filter((result) => result !== null) as ScorePredictionResult[];
        results.push(...validResults);
      } catch (concurrentError) {
        if (concurrentError instanceof Error) {
          console.error(`Concurrent prediction processing failed:`, concurrentError.message);
        } else {
          console.error(`Concurrent prediction processing failed (non-Error):`, concurrentError);
        }
      }

      // バッチ間の待機（レート制限対策）
      if (i + concurrentRequests < batches.length) {
        console.log(`⏱️ Waiting ${API_CONSTANTS.MAX_SCORE_DELAY_MS}ms between concurrent prediction batches...`);
        await new Promise((resolve) => setTimeout(resolve, API_CONSTANTS.MAX_SCORE_DELAY_MS));
      }
    }

    console.log(`✅ Completed max score prediction for ${results.length}/${allItems.length} items`);
    return results;
  } catch (error) {
    console.error('Error predicting max scores for user (basic info):', error);
    return [];
  }
}

// ==== レート制限/リトライ強化 ====
function parseRetryDelayMs(msg: string | undefined): number | null {
  if (!msg) return null;
  const match = msg.match(/retryDelay"?:"?(\d+)(s|sec)/i);
  if (match) {
    const sec = parseInt(match[1], 10);
    if (!isNaN(sec)) return sec * 1000;
  }
  return null;
}

let last429CooldownUntil = 0;

async function ensureCooldown() {
  const now = Date.now();
  if (now < last429CooldownUntil) {
    const wait = last429CooldownUntil - now;
    console.log(`⏳ Global cooldown active: waiting ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export async function predictMaxScores(
  apiKey: string,
  itemType: 'pull_request' | 'issue',
  itemData: any,
  cachedContent?: any,
): Promise<ScorePredictionResult | null> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // Cached Contentを使用する場合は指定、そうでなければ通常のモデル
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      // cachedContent があればそれを systemInstruction として再利用
      systemInstruction: cachedContent || generateMaxScorePredictionPrompt(),
    });

    const userPrompt = generateMaxScorePredictionUserPrompt(itemType, itemData);

    // リトライ機能付きでAPI呼び出し
    const result = await retryWithBackoff(async () => {
      return await model.generateContent(userPrompt);
    });

    const response = result.response;
    const text = response.text();

    if (!text) {
      console.warn('⚠️ Empty model response');
      return null;
    }

    const prediction = parseMaxScorePredictionResponse(text);
    if (!prediction) {
      console.warn('⚠️ Failed to parse prediction JSON. Raw snippet (first 400 chars):', text.slice(0, 400));
      return null;
    }
    if (!prediction.predictions.length) {
      console.warn('⚠️ Parsed but predictions array empty');
      return null;
    }
    return {
      itemType,
      itemNumber: itemType === 'pull_request' ? itemData.prNumber : itemData.issueNumber,
      title: itemType === 'pull_request' ? itemData.prTitle : itemData.issueTitle,
      repository: itemData.repository || 'unknown',
      predictions: prediction.predictions,
    };
  } catch (error) {
    console.error('Max score prediction error:', error);
    return null;
  }
}

export function parseMaxScorePredictionResponse(response: string): {
  predictions: MaxScorePrediction[];
} | null {
  try {
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      // 代替パターンを試す
      const altMatch1 = response.match(/```\n([\s\S]*?)\n```/);
      const altMatch2 = response.match(/\{[\s\S]*\}/);

      if (altMatch1) {
        try {
          const jsonData = JSON.parse(altMatch1[1]);
          return processMaxScorePredictionJsonData(jsonData);
        } catch (e) {
          console.error('Failed to parse max score alternative format 1:', e);
        }
      }

      if (altMatch2) {
        try {
          const jsonData = JSON.parse(altMatch2[0]);
          return processMaxScorePredictionJsonData(jsonData);
        } catch (e) {
          console.error('Failed to parse max score alternative format 1:', e);
        }
      }

      return null;
    }

    const jsonData = JSON.parse(jsonMatch[1]);
    return processMaxScorePredictionJsonData(jsonData);
  } catch (error) {
    console.error('Max score prediction parse error:', error);
    return null;
  }
}

function processMaxScorePredictionJsonData(jsonData: any): {
  predictions: MaxScorePrediction[];
} | null {
  if (!jsonData.predictions || !Array.isArray(jsonData.predictions)) {
    return null;
  }

  const predictions: MaxScorePrediction[] = jsonData.predictions.map((prediction: any) => ({
    criteria: prediction.criteria || 'Unknown',
    predictedMaxScore: Math.max(1, Math.min(4, prediction.predictedMaxScore || 1)),
    reasoning: prediction.reasoning || '',
  }));

  return {
    predictions,
  };
}
