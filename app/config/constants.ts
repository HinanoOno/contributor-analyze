// システム全体で使用する定数を一元化

export const EVALUATION_CONSTANTS = {
  // 評価レベルの範囲
  MIN_LEVEL: -1,
  MAX_LEVEL: 4,
  DEFAULT_LEVEL: 0,

  // 評価フラグのデフォルト値
  DEFAULT_EVALUABLE: true,
  DEFAULT_SURPRISE_FLAG: false,
  DEFAULT_INCIDENT_FLAG: false,

  // レベル名のマッピング
  LEVEL_NAMES: {
    [-1]: 'Needs Improvement',
    [0]: 'Neutral',
    [1]: 'Standard',
    [2]: 'Nice try',
    [3]: 'Very good',
    [4]: 'Mentor',
  } as const,
} as const;

export const API_CONSTANTS = {
  // リトライ設定
  DEFAULT_MAX_RETRIES: 3,
  DEFAULT_BASE_DELAY: 1000,

  // バッチ処理設定（並列処理向けに最適化）
  DEFAULT_BATCH_SIZE: 20, // バッチサイズを増加
  BATCH_DELAY_MS: 2000, // 待機時間を短縮

  // 並列処理設定
  MAX_SCORE_BATCH_SIZE: 30, // より大きなバッチサイズ
  MAX_SCORE_DELAY_MS: 1000, // 待機時間を短縮

  // 真の並列処理設定
  CONCURRENT_REQUESTS: 3, // 同時リクエスト数

  // コンテンツの長さ制限
  MAX_BODY_LENGTH: 2000,

  // キャッシュ設定
  CACHE_TTL_SECONDS: 3600,
} as const;

export const DATABASE_CONSTANTS = {
  // データベースファイル名
  DB_FILE: './repository_cache.sqlite',

  // テーブル名
  TABLES: {
    PULL_REQUESTS: 'pull_requests',
    PR_COMMENTS: 'pr_comments',
    ISSUES: 'issues',
    ISSUE_COMMENTS: 'issue_comments',
    EVALUATION_RESULTS: 'evaluation_results',
    ITEM_EVALUATIONS: 'item_evaluations',
    MAX_SCORE_PREDICTIONS: 'max_score_predictions',
  } as const,
} as const;

export const UI_CONSTANTS = {
  // 表示件数制限
  DEFAULT_DISPLAY_LIMIT: 20,

  // ローディングメッセージ
  LOADING_MESSAGES: {
    PREDICTION: '予測実行中...',
    EVALUATION: '評価実行中...',
    FETCHING: 'データ取得中...',
  } as const,

  // エラーメッセージ
  ERROR_MESSAGES: {
    UNKNOWN: '不明なエラーが発生しました',
    PREDICTION_FAILED: '予測処理でエラーが発生しました',
    EVALUATION_FAILED: '評価処理でエラーが発生しました',
    REQUIRED_FIELD: 'リポジトリ名を入力してください',
  } as const,
} as const;

export const GEMINI_CONSTANTS = {
  // モデル名
  MODEL_NAME: 'gemini-2.5-flash',

  // プロンプトの最大長
  MAX_PROMPT_LENGTH: 30000,

  // レスポンスパターン
  JSON_PATTERNS: {
    PRIMARY: /```json\n([\s\S]*?)\n```/,
    ALTERNATIVE_1: /```\n([\s\S]*?)\n```/,
    ALTERNATIVE_2: /\{[\s\S]*\}/,
  } as const,
} as const;
