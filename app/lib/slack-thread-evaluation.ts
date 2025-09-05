import { readEvaluationCriteria } from './evaluation-formatter';

export interface SlackThreadMessage {
  userId: string;
  text: string;
  postedAt: string;
}

// スレッド評価用のプロンプト生成（最高点予測込み）
export function generateSlackThreadEvaluationPrompt(
  username: string,
  channelId: string,
  threadTs: string,
  messages: SlackThreadMessage[],
  maxScorePredictions?: { [criteriaName: string]: number },
): string {
  const evaluationCriteria = readEvaluationCriteria();

  let maxScoreInfo = '';
  if (maxScorePredictions && Object.keys(maxScorePredictions).length > 0) {
    maxScoreInfo = `
# 予測最高点

このスレッドの各評価基準における予測最高点は以下の通りです：
${Object.entries(maxScorePredictions)
  .map(([criteria, score]) => `- ${criteria}: ${score}点`)
  .join('\n')}

評価時は、これらの予測最高点を考慮して、ユーザーの実際のパフォーマンスを評価してください。
例：予測最高点が2点の評価基準では、理論上2点が満点となります。
`;
  }

  return `あなたは厳格かつ公正なエンジニアリングマネージャーです。Slackのスレッド内での特定ユーザーの会話を分析し、以下の評価基準に基づいて客観的に評価してください。

# 評価基準

${evaluationCriteria}
${maxScoreInfo}
# 入力データ
ユーザー: ${username}
チャンネル: ${channelId}
スレッド: ${threadTs}

スレッド内の会話履歴:
\`\`\`
${messages.map((m) => `[${m.userId}] (${m.postedAt}): ${m.text}`).join('\n')}
\`\`\`

# 制約条件

- 分析対象データに、特定の評価項目に関する行動の証拠が全く見られない場合は、evaluable = false とすること
- スレッドの文脈と流れを考慮して評価すること
- 他の参加者との相互作用も評価に含めること
- 予測最高点が提供されている場合は、その値を上限として評価すること

# 出力形式

以下のJSONフォーマットで出力してください：

\`\`\`json
{
  "evaluations": [
    {
      "criteria": "評価基準名",
      "level": "-1-4の整数（予測最高点以下）",
      "levelName": "Needs Improvement/Neutral/Standard/Nice try/Very good/Mentor",
      "evidence": ["根拠となる具体的な行動例1", "根拠となる具体的な行動例2"],
      "reasoning": "この評価レベルを選んだ理由の詳細説明",
      "evaluable": true/false
    }
  ],
  "overallScore": 1-4の評価がついた項目のみの平均値,
  "summary": "総合的な評価コメント"
}
\`\`\`

各評価基準について、提供されたSlackスレッドの会話データから具体的な証拠を示し、客観的な評価を行ってください。証拠が不十分な場合は、その旨を明記してください。`;
}

// スレッドの最高点予測用プロンプト生成
export function generateSlackThreadMaxScorePredictionPrompt(
  channelId: string,
  threadTs: string,
  messages: SlackThreadMessage[],
): string {
  const evaluationCriteria = readEvaluationCriteria();

  return `あなたは経験豊富なエンジニアリングマネージャーです。Slackスレッドの内容を分析し、「もし仮に、理想的な開発者がこのスレッドに100%の力で貢献したとしたら、各評価基準において最高で何点を獲得することが可能だったか」という、スレッドの理論上の満点を予測してください。

# 禁止事項

実際の参加者の発言内容やコミュニケーション品質を評価・言及してはいけません。
あなたの分析対象は、あくまでスレッドの「話題」「課題」「文脈」です。

# 評価基準

${evaluationCriteria}

# 入力データ
チャンネル: ${channelId}
スレッド: ${threadTs}

スレッド内容:
\`\`\`
${messages.map((m) => `[${m.userId}] (${m.postedAt}): ${m.text}`).join('\n')}
\`\`\`

# 満点予測の考え方

各評価基準について、スレッドの以下の要素を考慮して満点を予測してください：

## 評価要素
- **複雑さ**: 技術的議論の難易度、問題の複雑さ
- **重要度**: 事業への影響、チームへの価値、緊急性
- **必要スキル**: 求められる技術力、コミュニケーション力、調整力
- **影響範囲**: 個人タスク < チーム議論 < 部門横断 < 全社的課題

## 満点レベル (1-4)
- **1点**: 基本的・簡単な話題（個人質問、定型的議論）
- **2点**: 標準的な話題（チーム内調整、一般的な技術議論）
- **3点**: 複雑な話題（部門横断、技術的挑戦、設計判断）
- **4点**: 非常に高度・困難な話題（全社影響、革新的、高度な専門知識）

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

各評価基準について、スレッドの内容から客観的に満点を予測してください。`;
}
