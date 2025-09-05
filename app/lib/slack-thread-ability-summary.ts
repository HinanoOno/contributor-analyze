import { getSlackThreadEvaluationsByUserAndCriteria, getSlackUserInfo } from './github-db';
import { calculateUserAbility } from './mle-logic';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_CONSTANTS } from '../config/constants';
import { getAllEvaluationCriteria } from './ability-summary-prompt';

/**
 * Slackスレッド評価用のシステムプロンプト
 */
export const SLACK_THREAD_SUMMARY_SYSTEM_PROMPT = `あなたは分析アシスタントです。1つの評価基準について、MLEで推定された能力値とその根拠となるSlackスレッド評価データを分析し、能力値の妥当性を簡潔に要約してください。

## 厳守ルール
- 出力は有効な JSON のみ。前後に説明文等を付与しない。
- surpriseFlag, incidentFlag がある場合は要約に反映する。
- 代表的なスレッドID（末尾6桁）を最大3つまで含める。(形式: thread-ABC123)
- 評価レベルが2以下の場合は、具体的な改善アクションを提案する。
- チャンネル横断でのスレッド参加状況を考慮する。

## 出力フォーマット
{
  "criteria_name": "評価基準名",
  "evaluation_level": 推定能力値(数値),
  "summary": "能力値の根拠を80〜150文字程度で要約した文章"
}
`;

/**
 * Slackスレッド評価用の入力データを生成
 */
export async function generateSlackThreadSummaryInput(
  username: string,
  criteriaName: string,
  channelIds?: string[],
): Promise<string | null> {
  // 1. ユーザー情報取得
  const userInfo = await getSlackUserInfo(username);
  if (!userInfo) {
    return null;
  }

  // 2. スレッド評価データを取得
  const evaluations = await getSlackThreadEvaluationsByUserAndCriteria(userInfo.userId, criteriaName, channelIds);

  if (!evaluations || evaluations.length === 0) {
    return null;
  }

  const validEvaluations = evaluations.filter((e) => e.evaluable && e.evaluationLevel !== null);

  if (validEvaluations.length === 0) {
    return null;
  }

  try {
    // 3. MLE能力値を計算
    const abilityResult = await calculateUserAbility(
      criteriaName,
      undefined,
      undefined,
      username,
      'slack-thread',
      channelIds,
    );

    let inputData = `# 評価基準「${criteriaName}」のSlackスレッド能力分析

## ユーザー: ${username}
## 対象チャンネル: ${channelIds ? channelIds.join(', ') : '全チャンネル'}

**MLE推定能力値:** ${abilityResult.ability.toFixed(2)}
**信頼区間:** ${abilityResult.confidenceInterval.lower.toFixed(2)} - ${abilityResult.confidenceInterval.upper.toFixed(2)}
**評価スレッド数:** ${validEvaluations.length}件

**スレッド別評価データ:**
`;

    // 4. 個別スレッド評価データを追加
    validEvaluations.forEach((evaluation, index) => {
      const threadId = evaluation.threadTs.slice(-6);
      const maxScoreText = evaluation.predictedMaxScore ? `/${evaluation.predictedMaxScore}点満点` : '';
      inputData += `${index + 1}. スレッド thread-${threadId} (チャンネル: ${evaluation.channelId}):
   - 評価レベル: ${evaluation.evaluationLevel}${maxScoreText}
   - 理由: ${evaluation.reasoning || 'なし'}
   - 証拠: ${evaluation.evidenceJson || 'なし'}
   - 評価日時: ${evaluation.evaluatedAt}

`;
    });

    // 5. チャンネル別の参加状況
    const channelStats = new Map<string, number>();
    validEvaluations.forEach((evaluation) => {
      const count = channelStats.get(evaluation.channelId) || 0;
      channelStats.set(evaluation.channelId, count + 1);
    });

    inputData += `**チャンネル別参加状況:**
`;
    Array.from(channelStats.entries()).forEach(([channelId, count]) => {
      inputData += `- ${channelId}: ${count}スレッド
`;
    });

    return inputData;
  } catch (error) {
    console.error(`Failed to calculate ability for ${criteriaName} (Slack threads):`, error);
    return null;
  }
}

/**
 * Slackスレッド評価用のキャッシュ管理
 */
let cachedSlackThreadSystemPrompt: { content: any; expiresAt: number } | null = null;
let creatingSlackThreadCachePromise: Promise<any> | null = null;

export async function generateSlackThreadSummarySystemPromptWithCache(apiKey: string): Promise<any | null> {
  const TTL_SECONDS = 3600; // 1 hour
  const now = Date.now();
  try {
    if (cachedSlackThreadSystemPrompt && cachedSlackThreadSystemPrompt.expiresAt > now) {
      console.log('📦 Using cached Slack thread summary system prompt');
      return cachedSlackThreadSystemPrompt.content;
    }

    if (creatingSlackThreadCachePromise) {
      return creatingSlackThreadCachePromise;
    }

    const promptText = SLACK_THREAD_SUMMARY_SYSTEM_PROMPT;
    creatingSlackThreadCachePromise = Promise.resolve(promptText)
      .then((text) => {
        cachedSlackThreadSystemPrompt = {
          content: text,
          expiresAt: Date.now() + (TTL_SECONDS - 5) * 1000,
        };
        console.log('✅ Slack thread summary system prompt cached');
        return text;
      })
      .finally(() => {
        creatingSlackThreadCachePromise = null;
      });

    return await creatingSlackThreadCachePromise;
  } catch (error) {
    console.error('Error generating Slack thread summary system prompt:', error);
    return null;
  }
}

/**
 * キャッシュを使用してSlackスレッド評価の単一基準を処理
 */
export async function processSlackThreadCriteriaWithCache(
  username: string,
  criteriaName: string,
  channelIds: string[],
  apiKey: string,
  preparedInput?: string | null,
): Promise<any> {
  try {
    const inputData = preparedInput ?? (await generateSlackThreadSummaryInput(username, criteriaName, channelIds));
    if (!inputData) {
      return null;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const cachedContent = await generateSlackThreadSummarySystemPromptWithCache(apiKey);

    // Cached Contentを使用する場合は指定、そうでなければ通常のモデル
    const model = genAI.getGenerativeModel({
      model: GEMINI_CONSTANTS.MODEL_NAME,
      // cachedContent があればそれを systemInstruction として再利用
      systemInstruction: cachedContent || SLACK_THREAD_SUMMARY_SYSTEM_PROMPT,
    });

    const result = await model.generateContent(inputData);

    return result;
  } catch (error) {
    console.error(`Error processing Slack thread ${criteriaName} with cache:`, error);
    throw error;
  }
}
