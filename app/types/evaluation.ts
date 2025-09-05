// 評価関連の型定義を一元化

export interface ItemData {
  id: number;
  pr_number?: number;
  issue_number?: number;
  title: string;
  body: string;
  comments: Array<{
    body: string;
    user_name: string;
  }>;
}

export interface BatchItemInput {
  type: 'pull_request' | 'issue';
  data: ItemData;
}

export interface EvaluationInput {
  prNumber?: number;
  prTitle?: string;
  prBody?: string;
  issueNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  comments: Array<{
    body: string;
    userLogin: string;
  }>;
}

export interface RawEvaluationResponse {
  criteria: string;
  level: number;
  levelName: string;
  evidence: string[];
  reasoning: string;
  evaluable?: boolean;
  surpriseFlag?: boolean;
  incidentFlag?: boolean;
}

export interface ParsedEvaluationData {
  evaluations: RawEvaluationResponse[];
  overallScore?: number;
  summary?: string;
}

export interface EvaluationResultWithFlags extends RawEvaluationResponse {
  evaluable: boolean;
  surpriseFlag: boolean;
  incidentFlag: boolean;
}

export interface MaxScorePredictions {
  [criteriaName: string]: number;
}
