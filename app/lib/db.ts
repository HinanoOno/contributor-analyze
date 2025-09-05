import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const DB_FILE = './repository_cache.sqlite';

export async function openDb() {
  return open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });
}

export async function initializeDatabase() {
  const db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });

  try {
    console.log('Initializing database tables...');

    await db.exec(`
      -- Pull Requests
      CREATE TABLE IF NOT EXISTS pull_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        repository_name TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at TEXT,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(repository_name, pr_number)
      );

      -- PR Comments
      CREATE TABLE IF NOT EXISTS pr_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_id INTEGER NOT NULL,  -- GitHub comment ID
        pr_id INTEGER NOT NULL,
        body TEXT,
        user_name TEXT,
        created_at TEXT,
        repository_name TEXT NOT NULL,
        FOREIGN KEY (pr_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
        UNIQUE(repository_name, comment_id)
      );

      -- Issues
      CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        repository_name TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at TEXT,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(repository_name, issue_number)
      );

      -- Issue Comments
      CREATE TABLE IF NOT EXISTS issue_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_id INTEGER NOT NULL,  -- GitHub comment ID
        issue_id INTEGER NOT NULL,
        body TEXT,
        user_name TEXT,
        created_at TEXT,
        repository_name TEXT NOT NULL,
        FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
        UNIQUE(repository_name, comment_id)
      );

      -- 評価結果を項目ごとに保存するテーブル
      CREATE TABLE IF NOT EXISTS evaluation_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_name TEXT NOT NULL,
        author TEXT NOT NULL,
        criteria_name TEXT NOT NULL,
        evaluation_level INTEGER,
        reasoning TEXT,
        evidence_json TEXT,
        evaluable BOOLEAN DEFAULT TRUE,
        surprise_flag BOOLEAN DEFAULT FALSE,
        incident_flag BOOLEAN DEFAULT FALSE,
        evaluated_at TEXT NOT NULL,
        UNIQUE(repository_name, author, criteria_name)
      );

      -- 個別PR/Issue評価結果を保存するテーブル
      CREATE TABLE IF NOT EXISTS item_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type TEXT NOT NULL,  -- 'pull_request' or 'issue'
        item_id INTEGER NOT NULL,  -- PR or Issue ID (DBのid)
        repository_name TEXT NOT NULL,
        author TEXT NOT NULL,
        criteria_name TEXT NOT NULL,
        evaluation_level INTEGER,
        reasoning TEXT,
        evidence_json TEXT,
        evaluable BOOLEAN DEFAULT TRUE,
        surprise_flag BOOLEAN DEFAULT FALSE,
        incident_flag BOOLEAN DEFAULT FALSE,
        evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(item_type, item_id, criteria_name)
      );

      -- 満点予測結果を保存するテーブル
      CREATE TABLE IF NOT EXISTS max_score_predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type TEXT NOT NULL,  -- 'pull_request' or 'issue'
        item_number INTEGER NOT NULL,  -- PR or Issue番号
        repository_name TEXT NOT NULL,
        author TEXT NOT NULL,
        criteria_name TEXT NOT NULL,
        predicted_max_score INTEGER NOT NULL,  -- 1-4の予測満点
        reasoning TEXT,  -- 予測理由
        predicted_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(item_type, item_number, repository_name, criteria_name)
      );

      -- ユーザーとアイテム（PR/Issue）の関与を記録する中間テーブル
      CREATE TABLE IF NOT EXISTS item_involvement (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author TEXT NOT NULL,          -- 関与したユーザー名
        item_type TEXT NOT NULL,
        item_id INTEGER NOT NULL,               -- pull_requests.id or issues.id
        involvement_type TEXT NOT NULL,  -- 'author', 'commenter'
        repository_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(author, item_type, item_id, involvement_type)
      );

      -- 能力サマリーを保存するテーブル
      CREATE TABLE IF NOT EXISTS ability_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_name TEXT NOT NULL,
        author TEXT NOT NULL,
        criteria_name TEXT NOT NULL,
        ability_score REAL NOT NULL,
        summary_text TEXT NOT NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(repository_name, author, criteria_name)
      );


      -- slackのユーザ情報を保存するテーブル
      CREATE TABLE IF NOT EXISTS slack_users (
        user_id TEXT PRIMARY KEY,
        real_name TEXT,
        display_name TEXT
      );
      
      -- slackのmessage情報を保存するテーブル
      CREATE TABLE IF NOT EXISTS slack_messages (
        message_ts TEXT PRIMARY KEY,
        thread_ts TEXT,
        user_id TEXT,
        text TEXT,
        channel_id TEXT,
        posted_at TEXT,
        reply_count INTEGER,
        FOREIGN KEY (user_id) REFERENCES slack_users(user_id) ON DELETE SET NULL
      );

      -- Slack評価結果を保存するテーブル（チャンネル別）
      CREATE TABLE IF NOT EXISTS slack_evaluation_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        criteria_name TEXT NOT NULL,
        evaluation_level INTEGER NOT NULL,
        reasoning TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        evaluable INTEGER NOT NULL DEFAULT 1,
        evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(channel_id, user_id, criteria_name),
        FOREIGN KEY (user_id) REFERENCES slack_users(user_id) ON DELETE CASCADE
      );

      -- Slack能力サマリーを保存するテーブル（ユーザー別統合）
      CREATE TABLE IF NOT EXISTS slack_ability_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        criteria_name TEXT NOT NULL,
        ability_score REAL NOT NULL,
        summary_text TEXT NOT NULL,
        channel_ids_json TEXT NOT NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, criteria_name),
        FOREIGN KEY (user_id) REFERENCES slack_users(user_id) ON DELETE CASCADE
      );

      -- スレッド評価結果を保存するテーブル
      CREATE TABLE IF NOT EXISTS slack_thread_user_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_ts TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        criteria_name TEXT NOT NULL,
        evaluation_level INTEGER NOT NULL,
        reasoning TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        evaluable INTEGER NOT NULL DEFAULT 1,
        surprise_flag BOOLEAN DEFAULT FALSE,
        incident_flag BOOLEAN DEFAULT FALSE,
        evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(thread_ts, channel_id, user_id, criteria_name),
        FOREIGN KEY (user_id) REFERENCES slack_users(user_id) ON DELETE CASCADE
      );

      -- スレッドの満点予測を保存するテーブル
      CREATE TABLE IF NOT EXISTS slack_thread_max_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_ts TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        criteria_name TEXT NOT NULL,
        predicted_max_score INTEGER NOT NULL,
        reasoning TEXT,
        predicted_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(thread_ts, channel_id, criteria_name)
      );
    `);
  } catch (error) {
    console.error('Failed to initialize database:', error);
  } finally {
    // 初期化処理が終わったら接続を閉じる
    await db.close();
  }
}
