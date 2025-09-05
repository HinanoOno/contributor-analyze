export const EVALUATION_CRITERIA = [
    'リーダーシップ領域',
    'チームワーク領域',
    '問題解決領域',
    'コミュニーケーション領域',
    '適応力領域',
    '継続的な学習・自己改善領域',
  ] as const;

export type EvaluationCriteria = (typeof EVALUATION_CRITERIA)[number];
