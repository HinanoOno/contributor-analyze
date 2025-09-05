// Issue types
export interface IssueComment {
  body: string;
  userLogin: string;
}

export interface ProcessedIssue {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueUser: string;
}

export interface IssueAnalysisResult {
  total_count: number;
  issues: ProcessedIssue[];
}

// API types
export interface AnalyzerRequest {
  owner: string;
  repo: string;
  author: string;
}
