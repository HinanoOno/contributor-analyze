import { getUserCriterionItemEvaluationsWithPredictions, type CriterionItemEvaluation } from './github-db';
import { calculateUserAbility } from './mle-logic';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_CONSTANTS } from '../config/constants';

/**
 * 単一基準用のシステムプロンプト（短縮版）
 */
export const SINGLE_CRITERIA_SUMMARY_SYSTEM_PROMPT = `あなたは分析アシスタントです。1つの評価基準について、MLEで推定された能力値とその根拠となる個別評価データを分析し、能力値の妥当性を簡潔に要約してください。

## 厳守ルール
- 出力は有効な JSON のみ。前後に説明文等を付与しない。
- surpriseFlag, incidentFlag がある場合は要約に反映する。
- 代表的なPR/Issueの番号を最大3つまで含める。(形式: pull_request#123 / issue#456)
- 評価レベルが2以下の場合は、具体的な改善アクションを提案する。

## 出力フォーマット
{
  "criteria_name": "評価基準名",
  "evaluation_level": 推定能力値(数値),
  "summary": "能力値の根拠を80〜150文字程度で要約した文章"
}
`;

/**
 * 単一の評価基準について能力サマリー生成用の入力を作成
 */
export async function generateSingleCriteriaSummaryInput(
  repositoryName: string,
  author: string,
  criteriaName: string,
): Promise<string | null> {
  // 1. 評価データを取得
  const evaluationData = await getUserCriterionItemEvaluationsWithPredictions(repositoryName, author);
  const evaluations = evaluationData[criteriaName];

  if (!evaluations) {
    return null;
  }

  const validEvaluations = evaluations.filter((e) => e.evaluable && e.evaluationLevel !== null);

  if (validEvaluations.length === 0) {
    return null;
  }

  try {
    // 2. MLE能力値を計算（GitHubソースを明示）
    const abilityResult = await calculateUserAbility(criteriaName, repositoryName, author, undefined, 'github');

    let inputData = `# 評価基準「${criteriaName}」の能力分析

## ユーザー: ${author}
## リポジトリ: ${repositoryName}

**MLE推定能力値:** ${abilityResult.ability.toFixed(2)}
**信頼区間:** ${abilityResult.confidenceInterval.lower.toFixed(2)} - ${abilityResult.confidenceInterval.upper.toFixed(2)}
**評価件数:** ${validEvaluations.length}件

**個別評価データ:**
`;

    // 3. 個別評価データを追加
    validEvaluations.forEach((evaluation, index) => {
      const itemType = evaluation.itemType === 'pull_request' ? 'pull_request' : 'issue';
      const maxScoreText = evaluation.predictedMaxScore ? `/${evaluation.predictedMaxScore}点満点` : '';
      inputData += `${index + 1}. ${itemType}#${evaluation.itemNumber} "${evaluation.title}":
   - 評価レベル: ${evaluation.evaluationLevel}${maxScoreText}
   - 理由: ${evaluation.evaluationReasoning || 'なし'}
   - 証拠: ${evaluation.evidenceJson || 'なし'}
   - surpriseFlag: ${evaluation.surpriseFlag ? 'あり' : 'なし'}
   - incidentFlag: ${evaluation.incidentFlag ? 'あり' : 'なし'}

`;
    });

    return inputData;
  } catch (error) {
    console.error(`Failed to calculate ability for ${criteriaName}:`, error);
    return null;
  }
}

/**
 * 単一基準の能力サマリーを生成するためのプロンプトを構築
 */
export async function generateSingleCriteriaSummaryPrompt(
  repositoryName: string,
  author: string,
  criteriaName: string,
): Promise<string | null> {
  const inputData = await generateSingleCriteriaSummaryInput(repositoryName, author, criteriaName);
  if (!inputData) {
    return null;
  }
  return SINGLE_CRITERIA_SUMMARY_SYSTEM_PROMPT + '\n\n' + inputData;
}

/**
 * EVALUATION_CRITERIAファイルから全評価基準名を抽出
 */
export function getAllEvaluationCriteria(): string[] {
  return [
    'リーダーシップ領域',
    'チームワーク領域',
    '問題解決領域',
    'コミュニーケーション領域',
    '適応力領域',
    '継続的な学習・自己改善領域',
  ];
}

// Cached Contentを管理するための変数（max-score-predictionパターンを踏襲）
// { content: キャッシュオブジェクト, expiresAt: 期限(Epoch ms) }
let cachedSystemPrompt: { content: any; expiresAt: number } | null = null;
// 競合防止: 同時多発のキャッシュ生成を１つにまとめる
let creatingCachePromise: Promise<any> | null = null;

export async function generateAbilitySummarySystemPromptWithCache(apiKey: string): Promise<any | null> {
  const TTL_SECONDS = 3600; // 1 hour
  const now = Date.now();
  try {
    if (cachedSystemPrompt && cachedSystemPrompt.expiresAt > now) {
      console.log('📦 Using cached ability summary system prompt');
      return cachedSystemPrompt.content;
    }

    if (creatingCachePromise) {
      return creatingCachePromise;
    }

    const promptText = SINGLE_CRITERIA_SUMMARY_SYSTEM_PROMPT;
    creatingCachePromise = Promise.resolve(promptText)
      .then((text) => {
        cachedSystemPrompt = {
          content: text,
          expiresAt: Date.now() + (TTL_SECONDS - 5) * 1000,
        };
        console.log('✅ Ability summary system prompt cached');
        return text;
      })
      .finally(() => {
        creatingCachePromise = null;
      });

    return await creatingCachePromise;
  } catch (error) {
    console.error('Error generating ability summary system prompt:', error);
    return null;
  }
}

/**
 * キャッシュを使用して単一基準の評価を実行
 */
export async function processSingleCriteriaWithCache(
  repositoryName: string,
  author: string,
  criteriaName: string,
  apiKey: string,
  preparedInput?: string | null,
): Promise<any> {
  try {
    const inputData = preparedInput ?? (await generateSingleCriteriaSummaryInput(repositoryName, author, criteriaName));
    if (!inputData) {
      return null;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const cachedContent = await generateAbilitySummarySystemPromptWithCache(apiKey);

    // Cached Contentを使用する場合は指定、そうでなければ通常のモデル
    const model = genAI.getGenerativeModel({
      model: GEMINI_CONSTANTS.MODEL_NAME,
      // cachedContent があればそれを systemInstruction として再利用
      systemInstruction: cachedContent || SINGLE_CRITERIA_SUMMARY_SYSTEM_PROMPT,
    });

    const result = await model.generateContent(inputData);

    return result;
  } catch (error) {
    console.error(`Error processing ${criteriaName} with cache:`, error);
    throw error;
  }
}
