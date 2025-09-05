import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProcessedIssue, ProcessedPullRequest } from '../types';
import { EVALUATION_CONSTANTS, GEMINI_CONSTANTS } from '../config/constants';
import type {
  EvaluationInput,
  MaxScorePredictions,
  ParsedEvaluationData,
  RawEvaluationResponse,
} from '../types/evaluation';

export interface AuthorData {
  repositorySlug: string;
  username: string;
  pullRequests: ProcessedPullRequest[];
  issues: ProcessedIssue[];
}

export interface EvaluationResult {
  criteria: string;
  level: number | null;
  levelName: string;
  evidence: string[];
  reasoning: string;
  evaluable: boolean;
  surpriseFlag: boolean; // 期待を上回る成果
  incidentFlag: boolean; // マイナスの酷い行動
}

export interface AuthorEvaluation {
  username: string;
  repositorySlug: string;
  overallScore: number;
  evaluations: EvaluationResult[];
  evaluatedAt: string;
}

export function readEvaluationCriteria(): string {
  try {
    const criteriaPath = join(process.cwd(), 'config', 'EVALUATION_CRITERIA.md');
    return readFileSync(criteriaPath, 'utf-8');
  } catch (error) {
    console.error('Error reading evaluation criteria:', error);
    throw new Error('評価基準ファイルの読み込みに失敗しました');
  }
}

export function formatAuthorDataForLLM(data: AuthorData): string {
  const { repositorySlug, username, pullRequests, issues } = data;

  let formattedData = `# GitHub Author Analysis for ${username} in ${repositorySlug}\n\n`;

  // Pull Requests section
  formattedData += `## Pull Requests (${pullRequests.length} total)\n\n`;
  pullRequests.forEach((pr, index) => {
    formattedData += `### PR #${pr.prNumber}: ${pr.prTitle}\n`;
    formattedData += `**Description:** ${pr.prBody || 'No description provided'}\n\n`;

    if (pr.comments.length > 0) {
      formattedData += `**Comments (${pr.comments.length}):**\n`;
      pr.comments.forEach((comment) => {
        formattedData += `- [${comment.userLogin}]: ${comment.body}\n`;
      });
    }
    formattedData += '\n---\n\n';
  });

  // Issues section
  formattedData += `## Issues (${issues.length} total)\n\n`;
  issues.forEach((issue, index) => {
    formattedData += `### Issue #${issue.issueNumber}: ${issue.issueTitle}\n`;
    formattedData += `**Created by:** ${issue.issueUser}\n`;
    formattedData += `**Description:** ${issue.issueBody || 'No description provided'}\n\n`;

    if (issue.comments.length > 0) {
      formattedData += `**Comments (${issue.comments.length}):**\n`;
      issue.comments.forEach((comment) => {
        formattedData += `- [${comment.userLogin}]: ${comment.body}\n`;
      });
    }
    formattedData += '\n---\n\n';
  });

  return formattedData;
}

export function generateCachedSystemPrompt(): string {
  const evaluationCriteria = readEvaluationCriteria();

  return `あなたは厳格かつ公正なエンジニアリングマネージャーです。GitHubでのエンジニアの活動を分析し、以下の評価基準に基づいて客観的に評価してください。

# 評価基準

${evaluationCriteria}

# 制約条件

- 分析対象データに、特定の評価項目に関する行動の証拠が全く見られない場合は、その項目を評価対象から除外すること。

# 出力形式

以下のJSONフォーマットで出力してください：

\`\`\`json
{
  "evaluations": [
    {
      "criteria": "評価基準名",
      "level": "-1-4の整数",
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

各評価基準について、提供されたGitHubデータから具体的な証拠を示し、客観的な評価を行ってください。証拠が不十分な場合は、その旨を明記してください。`;
}

export function generateUserPromptForItem(
  itemType: 'pull_request' | 'issue',
  itemData: EvaluationInput,
  maxScorePredictions: MaxScorePredictions = {},
): string {
  const itemNumber = itemType === 'pull_request' ? itemData.prNumber : itemData.issueNumber;
  const itemTitle = itemType === 'pull_request' ? itemData.prTitle : itemData.issueTitle;
  const itemBody = itemType === 'pull_request' ? itemData.prBody : itemData.issueBody;

  let prompt = `# 分析対象データ

## ${itemType === 'pull_request' ? 'Pull Request' : 'Issue'} #${itemNumber}: ${itemTitle}

**内容:**
${itemBody || '内容なし'}

`;

  if (itemData.comments && itemData.comments.length > 0) {
    prompt += `**コメント (${itemData.comments.length}件):**
`;
    itemData.comments.forEach((comment, index: number) => {
      prompt += `${index + 1}. ${comment.userLogin}: ${comment.body}
`;
    });
  } else {
    prompt += `**コメント:** なし
`;
  }

  // 満点情報を追加
  if (Object.keys(maxScorePredictions).length > 0) {
    prompt += `

# 満点情報

この${itemType === 'pull_request' ? 'Pull Request' : 'Issue'}における各評価基準の理論上の満点は以下の通りです：

${Object.entries(maxScorePredictions)
  .map(([criteria, maxScore]) => `- **${criteria}**: 満点 ${maxScore}点`)
  .join('\n')}

この満点情報を参考に、該当する評価基準の難易度を考慮してエンジニアの適切なレベルを評価してください。`;
  }

  prompt += `

**重要**: 上記の${itemType === 'pull_request' ? 'Pull Request' : 'Issue'}データを評価基準に基づいて分析し、必ず以下の形式のJSONで回答してください：

\`\`\`json
{
  "evaluations": [
    {
      "criteria": "評価基準名",
      "level": "-1-4の整数",
      "levelName": "Needs Improvement/Neutral/Standard/Nice try/Very good/Mentor",
      "evidence": ["根拠1", "根拠2"],
      "reasoning": "評価理由",
      "evaluable": true/false
    }
  ]
}
\`\`\`

evaluations配列を必ず含めて回答してください。`;

  return prompt;
}

export function generateEvaluationPrompt(authorData: string): string {
  const evaluationCriteria = readEvaluationCriteria();

  return `あなたは厳格かつ公正なエンジニアリングマネージャーです。GitHubでのエンジニアの活動を分析し、以下の評価基準に基づいて客観的に評価してください。

# 評価基準

${evaluationCriteria}

# 分析対象データ

${authorData}

# 制約条件

- 分析対象データに、特定の評価項目に関する行動の証拠が全く見られない場合は、evaluable = false とすること

# 出力形式

以下のJSONフォーマットで出力してください：

\`\`\`json
{
  "evaluations": [
    {
      "criteria": "評価基準名",
      "level": "-1-4の整数",
      "levelName": "Needs Improvement/Neutral/Standard/Nice try/Very good/Mentor",
      "evidence": ["根拠となる具体的な行動例1", "根拠となる具体的な行動例2"],
      "reasoning": "この評価レベルを選んだ理由の詳細説明",
      "evaluable": true/false
    }
  ]
}
\`\`\`

各評価基準について、提供されたGitHubデータから具体的な証拠を示し、客観的な評価を行ってください。証拠が不十分な場合は、その旨を明記してください。`;
}

export function parseEvaluationResponseWithPredictions(
  response: string,
  maxScorePredictions: MaxScorePredictions = {},
): Partial<AuthorEvaluation> | null {
  try {
    console.log('🔍 Parsing response with predictions, length:', response.length);
    console.log('🔍 Max score predictions:', maxScorePredictions);
    console.log('🔍 First 200 chars:', response.substring(0, 200));

    const jsonMatch = response.match(GEMINI_CONSTANTS.JSON_PATTERNS.PRIMARY);
    if (!jsonMatch) {
      console.error('JSON format not found in response');
      console.log('🔍 Looking for alternative JSON patterns...');

      // 代替パターンを試す
      const altMatch1 = response.match(GEMINI_CONSTANTS.JSON_PATTERNS.ALTERNATIVE_1);
      const altMatch2 = response.match(GEMINI_CONSTANTS.JSON_PATTERNS.ALTERNATIVE_2);

      if (altMatch1) {
        console.log('🔍 Found JSON in ``` blocks:', altMatch1[1].substring(0, 100));
        try {
          const jsonData = JSON.parse(altMatch1[1]);
          return processJsonDataWithPredictions(jsonData, maxScorePredictions);
        } catch (e) {
          console.error('Failed to parse alternative format 1:', e);
        }
      }

      if (altMatch2) {
        console.log('🔍 Found JSON pattern:', altMatch2[0].substring(0, 100));
        try {
          const jsonData = JSON.parse(altMatch2[0]);
          return processJsonDataWithPredictions(jsonData, maxScorePredictions);
        } catch (e) {
          console.error('Failed to parse alternative format 2:', e);
        }
      }

      return null;
    }

    console.log('🔍 Found JSON block:', jsonMatch[1].substring(0, 100));
    const jsonData = JSON.parse(jsonMatch[1]);
    return processJsonDataWithPredictions(jsonData, maxScorePredictions);
  } catch (error) {
    console.error('Parse error:', error);
    return null;
  }
}

export function parseEvaluationResponse(response: string): Partial<AuthorEvaluation> | null {
  try {
    console.log('🔍 Parsing response, length:', response.length);
    console.log('🔍 First 200 chars:', response.substring(0, 200));

    const jsonMatch = response.match(GEMINI_CONSTANTS.JSON_PATTERNS.PRIMARY);
    if (!jsonMatch) {
      console.error('JSON format not found in response');
      console.log('🔍 Looking for alternative JSON patterns...');

      // 代替パターンを試す
      const altMatch1 = response.match(GEMINI_CONSTANTS.JSON_PATTERNS.ALTERNATIVE_1);
      const altMatch2 = response.match(GEMINI_CONSTANTS.JSON_PATTERNS.ALTERNATIVE_2);

      if (altMatch1) {
        console.log('🔍 Found JSON in ``` blocks:', altMatch1[1].substring(0, 100));
        try {
          const jsonData = JSON.parse(altMatch1[1]);
          return processJsonData(jsonData);
        } catch (e) {
          console.error('Failed to parse alternative format 1:', e);
        }
      }

      if (altMatch2) {
        console.log('🔍 Found JSON pattern:', altMatch2[0].substring(0, 100));
        try {
          const jsonData = JSON.parse(altMatch2[0]);
          return processJsonData(jsonData);
        } catch (e) {
          console.error('Failed to parse alternative format 2:', e);
        }
      }

      return null;
    }

    console.log('🔍 Found JSON block:', jsonMatch[1].substring(0, 100));
    const jsonData = JSON.parse(jsonMatch[1]);
    return processJsonData(jsonData);
  } catch (error) {
    console.error('Parse error:', error);
    return null;
  }
}

function adjustEvaluationWithPredictions(
  evaluation: RawEvaluationResponse,
  maxScorePredictions: MaxScorePredictions,
): RawEvaluationResponse {
  const level = evaluation.level;
  const criteria = evaluation.criteria;
  const predictedMaxScore = maxScorePredictions[criteria];

  let adjustedLevel = level;
  let surpriseFlag = evaluation.surpriseFlag === true;
  let incidentFlag = evaluation.incidentFlag === true;

  // 負の値ならincidentFlag=true, level=0
  if (level < 0) {
    incidentFlag = true;
    adjustedLevel = 0;
  }
  // 予測最高点より上ならsurpriseFlag=true, level=予測最高点
  else if (predictedMaxScore && level > predictedMaxScore) {
    surpriseFlag = true;
    adjustedLevel = predictedMaxScore;
  }

  return {
    ...evaluation,
    level: adjustedLevel,
    surpriseFlag,
    incidentFlag,
  };
}

function processJsonDataWithPredictions(
  jsonData: ParsedEvaluationData,
  maxScorePredictions: MaxScorePredictions,
): Partial<AuthorEvaluation> | null {
  if (!jsonData.evaluations || !Array.isArray(jsonData.evaluations)) {
    console.error('Invalid evaluation format - missing evaluations array');
    console.log('🔍 JSON structure:', JSON.stringify(jsonData, null, 2));
    return null;
  }

  const evaluations: EvaluationResult[] = jsonData.evaluations.map((evaluation) => {
    // 満点予測と比較してフラグとレベルを調整
    const adjusted = adjustEvaluationWithPredictions(evaluation, maxScorePredictions);

    return {
      criteria: adjusted.criteria,
      level: adjusted.level,
      levelName: adjusted.levelName,
      evidence: adjusted.evidence || [],
      reasoning: adjusted.reasoning || '',
      evaluable: adjusted.evaluable !== false,
      surpriseFlag: adjusted.surpriseFlag,
      incidentFlag: adjusted.incidentFlag,
    };
  });

  return {
    overallScore: jsonData.overallScore || 0,
    evaluations,
    evaluatedAt: new Date().toISOString(),
  };
}

function processJsonData(jsonData): Partial<AuthorEvaluation> | null {
  if (!jsonData.evaluations || !Array.isArray(jsonData.evaluations)) {
    console.error('Invalid evaluation format - missing evaluations array');
    console.log('🔍 JSON structure:', JSON.stringify(jsonData, null, 2));
    return null;
  }

  const evaluations: EvaluationResult[] = jsonData.evaluations.map((evaluation) => ({
    criteria: evaluation.criteria,
    level: evaluation.level,
    levelName: evaluation.levelName,
    evidence: evaluation.evidence || [],
    reasoning: evaluation.reasoning || '',
    evaluable: evaluation.evaluable !== false, // Default to true if not specified
    surpriseFlag: evaluation.surpriseFlag === true, // Default to false
    incidentFlag: evaluation.incidentFlag === true, // Default to false
  }));

  return {
    overallScore: jsonData.overallScore || 0,
    evaluations,
    evaluatedAt: new Date().toISOString(),
  };
}
