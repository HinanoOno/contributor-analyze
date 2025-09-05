import { getDbConnection } from './db-connection';
import type { AuthorEvaluation } from './evaluation-formatter';

export interface PullRequestData {
  prNumber: number;
  title: string;
  body: string;
  repositoryName: string;
  author: string;
  createdAt?: string;
}

export interface IssueData {
  issueNumber: number;
  title: string;
  body: string;
  repositoryName: string;
  author: string;
  createdAt?: string;
}

async function insertInvolvement(
  db: any,
  params: {
    author: string;
    itemType: 'pull_request' | 'issue';
    itemId: number; // internal DB id
    involvementType: 'author' | 'commenter';
    repositoryName: string;
  },
) {
  if (!params.author) return;
  try {
    await db.run(
      `INSERT OR IGNORE INTO item_involvement 
        (author, item_type, item_id, involvement_type, repository_name)
       VALUES (?, ?, ?, ?, ?)`,
      [params.author, params.itemType, params.itemId, params.involvementType, params.repositoryName],
    );
  } catch (e) {
    console.error('Failed to insert involvement', e);
  }
}

// Pull Request保存関数
export async function savePullRequest(prData: PullRequestData) {
  const db = await getDbConnection();
  try {
    const result = await db.run(
      `
      INSERT INTO pull_requests (
        pr_number, title, body, repository_name, author, created_at, fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repository_name, pr_number) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        author = excluded.author,
        created_at = excluded.created_at,
        fetched_at = excluded.fetched_at
      `,
      [
        prData.prNumber,
        prData.title,
        prData.body,
        prData.repositoryName,
        prData.author,
        prData.createdAt || new Date().toISOString(),
        new Date().toISOString(),
      ],
    );

    // UPSERTの後に実際のIDを取得
    const prRow = await db.get('SELECT id FROM pull_requests WHERE repository_name = ? AND pr_number = ?', [
      prData.repositoryName,
      prData.prNumber,
    ]);

    if (!prRow) {
      throw new Error('Failed to retrieve PR ID after upsert');
    }
    const prId: number = prRow.id;

    await insertInvolvement(db, {
      author: prData.author,
      itemType: 'pull_request',
      itemId: prId,
      involvementType: 'author',
      repositoryName: prData.repositoryName,
    });
    return prId;
  } catch (error) {
    console.error('Error saving pull request:', error);
    throw error;
  }
}

export async function savePullRequestComment(params: {
  commentId: number;
  prId: number;
  body: string;
  userName: string;
  createdAt?: string;
  repositoryName: string;
}) {
  const db = await getDbConnection();
  await db.run(
    `
    INSERT INTO pr_comments (
      comment_id, pr_id, body, user_name, created_at, repository_name
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(repository_name, comment_id) DO UPDATE SET
      pr_id = excluded.pr_id,
      body = excluded.body,
      user_name = excluded.user_name,
      created_at = excluded.created_at
    `,
    [
      params.commentId,
      params.prId,
      params.body,
      params.userName,
      params.createdAt || new Date().toISOString(),
      params.repositoryName,
    ],
  );
  await insertInvolvement(db, {
    author: params.userName,
    itemType: 'pull_request',
    itemId: params.prId,
    involvementType: 'commenter',
    repositoryName: params.repositoryName,
  });
}

// Issue 本体のみ保存
export async function saveIssue(issueData: IssueData) {
  const db = await getDbConnection();
  try {
    const result = await db.run(
      `
      INSERT INTO issues (
        issue_number, title, body, repository_name, author, created_at, fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repository_name, issue_number) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        author = excluded.author,
        created_at = excluded.created_at,
        fetched_at = excluded.fetched_at
      `,
      [
        issueData.issueNumber,
        issueData.title,
        issueData.body,
        issueData.repositoryName,
        issueData.author,
        issueData.createdAt || new Date().toISOString(),
        new Date().toISOString(),
      ],
    );

    // UPSERTの後に実際のIDを取得
    const issueRow = await db.get('SELECT id FROM issues WHERE repository_name = ? AND issue_number = ?', [
      issueData.repositoryName,
      issueData.issueNumber,
    ]);

    if (!issueRow) {
      throw new Error('Failed to retrieve issue ID after upsert');
    }
    const issueId: number = issueRow.id;

    await insertInvolvement(db, {
      author: issueData.author,
      itemType: 'issue',
      itemId: issueId,
      involvementType: 'author',
      repositoryName: issueData.repositoryName,
    });
    return issueId;
  } catch (error) {
    console.error('Error saving issue:', error);
    throw error;
  }
}

// Issue コメント単体保存
export async function saveIssueComment(params: {
  commentId: number;
  issueId: number;
  body: string;
  userName: string;
  createdAt?: string;
  repositoryName: string;
}) {
  const db = await getDbConnection();
  await db.run(
    `
    INSERT INTO issue_comments (
      comment_id, issue_id, body, user_name, created_at, repository_name
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(repository_name, comment_id) DO UPDATE SET
      issue_id = excluded.issue_id,
      body = excluded.body,
      user_name = excluded.user_name,
      created_at = excluded.created_at
    `,
    [
      params.commentId,
      params.issueId,
      params.body,
      params.userName,
      params.createdAt || new Date().toISOString(),
      params.repositoryName,
    ],
  );
  await insertInvolvement(db, {
    author: params.userName,
    itemType: 'issue',
    itemId: params.issueId,
    involvementType: 'commenter',
    repositoryName: params.repositoryName,
  });
}

export async function getAllPullRequests() {
  const db = await getDbConnection();

  try {
    const rows = await db.all(`
      SELECT 
        pr.id as pr_id,
        pr.pr_number,
        pr.title,
        pr.body,
        pr.repository_name,
        pr.author,
        pr.created_at,
        pr.fetched_at,
        c.body as comment_body,
        c.user_name as comment_user,
        c.created_at as comment_created_at
      FROM pull_requests pr
      LEFT JOIN pr_comments c ON pr.id = c.pr_id
      ORDER BY pr.fetched_at DESC, c.created_at ASC
    `);

    const prMap = new Map();

    for (const row of rows) {
      const prId = row.pr_id;

      if (!prMap.has(prId)) {
        prMap.set(prId, {
          id: row.pr_id,
          pr_number: row.pr_number,
          title: row.title,
          body: row.body,
          repository_name: row.repository_name,
          author: row.author,
          created_at: row.created_at,
          fetched_at: row.fetched_at,
          comments: [],
        });
      }

      // コメントが存在する場合のみ追加
      if (row.comment_body) {
        prMap.get(prId).comments.push({
          body: row.comment_body,
          user_name: row.comment_user,
          created_at: row.comment_created_at,
        });
      }
    }

    return Array.from(prMap.values());
  } catch (error) {
    console.error('Error getting all pull requests:', error);
    throw error;
  }
}

export async function getAllIssues() {
  const db = await getDbConnection();

  try {
    const rows = await db.all(`
      SELECT 
        i.id as issue_id,
        i.issue_number,
        i.title,
        i.body,
        i.repository_name,
        i.author,
        i.created_at,
        i.fetched_at,
        c.body as comment_body,
        c.user_name as comment_user,
        c.created_at as comment_created_at
      FROM issues i
      LEFT JOIN issue_comments c ON i.id = c.issue_id
      ORDER BY i.fetched_at DESC, c.created_at ASC
    `);

    const issueMap = new Map();

    for (const row of rows) {
      const issueId = row.issue_id;

      if (!issueMap.has(issueId)) {
        issueMap.set(issueId, {
          id: row.issue_id,
          issue_number: row.issue_number,
          title: row.title,
          body: row.body,
          repository_name: row.repository_name,
          author: row.author,
          created_at: row.created_at,
          fetched_at: row.fetched_at,
          comments: [],
        });
      }

      // コメントが存在する場合のみ追加
      if (row.comment_body) {
        issueMap.get(issueId).comments.push({
          body: row.comment_body,
          user_name: row.comment_user,
          created_at: row.comment_created_at,
        });
      }
    }

    return Array.from(issueMap.values());
  } catch (error) {
    console.error('Error getting all issues:', error);
    throw error;
  }
}

// 特定の条件でPR/Issueを取得する関数
export async function getPullRequestsByAuthor(repositoryName: string, author: string) {
  const db = await getDbConnection();

  try {
    const rows = await db.all(
      `
      SELECT 
        pr.id as pr_id,
        pr.pr_number,
        pr.title,
        pr.body,
        pr.repository_name,
        pr.author,
        pr.created_at,
        pr.fetched_at,
        c.body as comment_body,
        c.user_name as comment_user,
        c.created_at as comment_created_at
      FROM pull_requests pr
      LEFT JOIN pr_comments c ON pr.id = c.pr_id
      WHERE pr.repository_name = ? AND pr.author = ?
      ORDER BY pr.pr_number DESC, c.created_at ASC
    `,
      [repositoryName, author],
    );

    const prMap = new Map();

    for (const row of rows) {
      const prId = row.pr_id;

      if (!prMap.has(prId)) {
        prMap.set(prId, {
          id: row.pr_id,
          pr_number: row.pr_number,
          title: row.title,
          body: row.body,
          repository_name: row.repository_name,
          author: row.author,
          created_at: row.created_at,
          fetched_at: row.fetched_at,
          comments: [],
        });
      }

      // コメントが存在する場合のみ追加
      if (row.comment_body) {
        prMap.get(prId).comments.push({
          body: row.comment_body,
          user_name: row.comment_user,
          created_at: row.comment_created_at,
        });
      }
    }

    return Array.from(prMap.values());
  } catch (error) {
    console.error('Error getting pull requests by author:', error);
    throw error;
  }
}

export async function getIssuesByAuthor(repositoryName: string, author: string) {
  const db = await getDbConnection();

  try {
    const rows = await db.all(
      `
      SELECT 
        i.id as issue_id,
        i.issue_number,
        i.title,
        i.body,
        i.repository_name,
        i.author,
        i.created_at,
        i.fetched_at,
        c.body as comment_body,
        c.user_name as comment_user,
        c.created_at as comment_created_at
      FROM issues i
      LEFT JOIN issue_comments c ON i.id = c.issue_id
      WHERE i.repository_name = ? AND i.author = ?
      ORDER BY i.issue_number DESC, c.created_at ASC
    `,
      [repositoryName, author],
    );

    const issueMap = new Map();

    for (const row of rows) {
      const issueId = row.issue_id;

      if (!issueMap.has(issueId)) {
        issueMap.set(issueId, {
          id: row.issue_id,
          issue_number: row.issue_number,
          title: row.title,
          body: row.body,
          repository_name: row.repository_name,
          author: row.author,
          created_at: row.created_at,
          fetched_at: row.fetched_at,
          comments: [],
        });
      }

      // コメントが存在する場合のみ追加
      if (row.comment_body) {
        issueMap.get(issueId).comments.push({
          body: row.comment_body,
          user_name: row.comment_user,
          created_at: row.comment_created_at,
        });
      }
    }

    return Array.from(issueMap.values());
  } catch (error) {
    console.error('Error getting issues by author:', error);
    throw error;
  }
}

// 指定したユーザが関与している全てのプルリクを取得
export async function getInvolvedPullRequests(repositoryName: string, username: string) {
  const db = await getDbConnection();

  try {
    // 1. 中間テーブルから、指定ユーザーが関与した全PRのIDを取得
    const involvementRows = await db.all(
      `
      SELECT DISTINCT item_id 
      FROM item_involvement
      WHERE repository_name = ? 
        AND author = ? 
        AND item_type = 'pull_request'
      `,
      [repositoryName, username],
    );

    const prIds = involvementRows.map((row) => row.item_id);

    if (prIds.length === 0) {
      return []; // 関与したPRがなければ空配列を返す
    }

    // 2. 取得したIDを基に、PR本体と全コメントを取得
    const prDataRows = await db.all(
      `
      SELECT 
        pr.id as pr_id,
        pr.pr_number,
        pr.title,
        pr.body,
        pr.repository_name,
        pr.author as author,
        pr.created_at,
        pr.fetched_at,
        c.body as comment_body,
        c.user_name as comment_user,
        c.created_at as comment_created_at
      FROM pull_requests pr
      LEFT JOIN pr_comments c ON pr.id = c.pr_id
      WHERE pr.id IN (${prIds.map(() => '?').join(',')}) -- IN句で効率的に絞り込み
      ORDER BY pr.pr_number DESC, c.created_at ASC
    `,
      prIds,
    );

    // 3. 取得したデータをPRごとにまとめる
    const prMap = new Map();
    for (const row of prDataRows) {
      const prId = row.pr_id;

      if (!prMap.has(prId)) {
        prMap.set(prId, {
          id: row.pr_id,
          pr_number: row.pr_number,
          title: row.title,
          body: row.body,
          repository_name: row.repository_name,
          author: row.author,
          created_at: row.created_at,
          fetched_at: row.fetched_at,
          comments: [],
        });
      }

      if (row.comment_body) {
        prMap.get(prId).comments.push({
          body: row.comment_body,
          user_name: row.comment_user,
          created_at: row.comment_created_at,
        });
      }
    }

    return Array.from(prMap.values());
  } catch (error) {
    console.error('Error getting involved pull requests:', error);
    throw error;
  }
}

export async function getInvolvedIssues(repositoryName: string, username: string) {
  const db = await getDbConnection();

  try {
    // 1. 中間テーブルから、指定ユーザーが関与した全IssueのIDを取得
    const involvementRows = await db.all(
      `
      SELECT DISTINCT item_id 
      FROM item_involvement
      WHERE repository_name = ? 
        AND author = ? 
        AND item_type = 'issue'
      `,
      [repositoryName, username],
    );

    const issueIds = involvementRows.map((row) => row.item_id);

    if (issueIds.length === 0) {
      return []; // 関与したIssueがなければ空配列を返す
    }

    // 2. 取得したIDを基に、Issue本体と全コメントを取得
    const issueDataRows = await db.all(
      `
      SELECT 
        i.id as issue_id,
        i.issue_number,
        i.title,
        i.body,
        i.repository_name,
        i.author as author,
        i.created_at,
        i.fetched_at,
        c.body as comment_body,
        c.user_name as comment_user,
        c.created_at as comment_created_at
      FROM issues i
      LEFT JOIN issue_comments c ON i.id = c.issue_id
      WHERE i.id IN (${issueIds.map(() => '?').join(',')}) -- IN句で効率的に絞り込み
      ORDER BY i.issue_number DESC, c.created_at ASC
    `,
      issueIds,
    );

    // 3. 取得したデータをIssueごとにまとめる
    const issueMap = new Map();
    for (const row of issueDataRows) {
      const issueId = row.issue_id;

      if (!issueMap.has(issueId)) {
        issueMap.set(issueId, {
          id: row.issue_id,
          issue_number: row.issue_number,
          title: row.title,
          body: row.body,
          repository_name: row.repository_name,
          author: row.author,
          created_at: row.created_at,
          fetched_at: row.fetched_at,
          comments: [],
        });
      }

      if (row.comment_body) {
        issueMap.get(issueId).comments.push({
          body: row.comment_body,
          user_name: row.comment_user,
          created_at: row.comment_created_at,
        });
      }
    }

    return Array.from(issueMap.values());
  } catch (error) {
    console.error('Error getting involved issues:', error);
    throw error;
  }
}

// LLM評価用のデータ取得関数（関与したPR/Issue全てを含む）
export async function getAuthorDataForEvaluation(repositoryName: string, username: string) {
  try {
    const [pullRequests, issues] = await Promise.all([
      getInvolvedPullRequests(repositoryName, username),
      getInvolvedIssues(repositoryName, username),
    ]);

    // LLM分析用の形式に変換
    const formattedPRs = pullRequests.map((pr) => ({
      prNumber: pr.pr_number,
      prTitle: pr.title,
      prBody: pr.body || '',
      comments: pr.comments.map((c) => ({
        body: c.body || '',
        userLogin: c.user_name || '',
      })),
    }));

    const formattedIssues = issues.map((issue) => ({
      issueNumber: issue.issue_number,
      issueTitle: issue.title,
      issueBody: issue.body || '',
      issueUser: issue.author,
      comments: issue.comments.map((c) => ({
        body: c.body || '',
        userLogin: c.user_name || '',
      })),
    }));

    return {
      pullRequests: formattedPRs,
      issues: formattedIssues,
    };
  } catch (error) {
    console.error('Error getting author data for evaluation:', error);
    throw error;
  }
}

// 個別PR/Issue評価を保存する関数
export async function saveItemEvaluation(
  itemType: 'pull_request' | 'issue',
  itemId: number,
  repositoryName: string,
  author: string,
  criteriaName: string,
  evaluationLevel: number,
  reasoning: string,
  evidenceJson: string,
  evaluable: boolean = true,
  surpriseFlag: boolean = false,
  incidentFlag: boolean = false,
) {
  const db = await getDbConnection();

  try {
    await db.run(
      `
      INSERT INTO item_evaluations (
        item_type, item_id, repository_name, author, criteria_name, 
        evaluation_level, reasoning, evidence_json, evaluable, surprise_flag, incident_flag
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_type, item_id, criteria_name) DO UPDATE SET
        repository_name = excluded.repository_name,
        author = excluded.author,
        evaluation_level = excluded.evaluation_level,
        reasoning = excluded.reasoning,
        evidence_json = excluded.evidence_json,
        evaluable = excluded.evaluable,
        surprise_flag = excluded.surprise_flag,
        incident_flag = excluded.incident_flag,
        evaluated_at = datetime('now')
      `,
      [
        itemType,
        itemId,
        repositoryName,
        author,
        criteriaName,
        evaluationLevel,
        reasoning,
        evidenceJson,
        evaluable,
        surpriseFlag,
        incidentFlag,
      ],
    );

    console.log(`Saved ${itemType} evaluation for item ${itemId}, criteria: ${criteriaName}`);
    return true;
  } catch (error) {
    console.error('Error saving item evaluation:', error);
    throw error;
  }
}

export async function saveAuthorEvaluation(repositoryName: string, username: string, evaluation: AuthorEvaluation) {
  const db = await getDbConnection();

  try {
    const evaluatedAt = new Date().toISOString();

    for (const criterion of evaluation.evaluations) {
      // evidenceが配列の場合はカンマ区切りの文字列に変換
      let evidenceStr = '';
      if (Array.isArray(criterion.evidence)) {
        evidenceStr = criterion.evidence.join(', ');
      } else if (typeof criterion.evidence === 'string') {
        evidenceStr = criterion.evidence;
      } else {
        evidenceStr = JSON.stringify(criterion.evidence);
      }

      await db.run(
        `INSERT INTO evaluation_results
          (repository_name, author, criteria_name, evaluation_level, reasoning, evidence_json, evaluable, surprise_flag, incident_flag, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          repositoryName,
          username,
          criterion.criteria,
          criterion.level,
          criterion.reasoning,
          evidenceStr,
          criterion.evaluable,
          criterion.surpriseFlag,
          criterion.incidentFlag,
          evaluatedAt,
        ],
      );
    }

    console.log(`Saved evaluation results for ${username} in ${repositoryName}`);
    return true;
  } catch (error) {
    console.error('Error saving author evaluation:', error);
    throw error;
  }
}

// 満点予測結果を保存する関数
export async function saveMaxScorePrediction(
  itemType: 'pull_request' | 'issue',
  itemNumber: number,
  repositoryName: string,
  author: string,
  criteriaName: string,
  predictionData: {
    predictedMaxScore: number;
    reasoning: string;
  },
) {
  const db = await getDbConnection();

  try {
    await db.run(
      `
      INSERT INTO max_score_predictions (
        item_type, item_number, repository_name, author,
        criteria_name, predicted_max_score, reasoning, predicted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_type, item_number, repository_name, criteria_name) DO UPDATE SET
        author = excluded.author,
        predicted_max_score = excluded.predicted_max_score,
        reasoning = excluded.reasoning,
        predicted_at = excluded.predicted_at
      `,
      [
        itemType,
        itemNumber,
        repositoryName,
        author,
        criteriaName,
        predictionData.predictedMaxScore,
        predictionData.reasoning,
        new Date().toISOString(),
      ],
    );

    console.log(`Saved max score prediction for ${itemType} ${itemNumber}, criteria: ${criteriaName}`);
    return true;
  } catch (error) {
    console.error('Error saving max score prediction:', error);
    throw error;
  }
}

// 満点予測結果を取得する関数
export async function getMaxScorePredictions(
  itemType: 'pull_request' | 'issue',
  itemNumber: number,
  repositoryName: string,
): Promise<{ [criteriaName: string]: number }> {
  const db = await getDbConnection();

  try {
    const results = await db.all(
      `SELECT criteria_name, predicted_max_score FROM max_score_predictions 
       WHERE item_type = ? AND item_number = ? AND repository_name = ?`,
      [itemType, itemNumber, repositoryName],
    );

    const predictions: { [criteriaName: string]: number } = {};
    for (const result of results) {
      predictions[result.criteria_name] = result.predicted_max_score;
    }

    return predictions;
  } catch (error) {
    console.error('Error getting max score predictions:', error);
    return {};
  }
}

// 特定ユーザーが関与したIssueの基本情報のみを取得
export async function getInvolvedIssuesBasicInfo(repositoryName: string, username: string) {
  const db = await getDbConnection();

  try {
    const results = await db.all(
      `SELECT DISTINCT i.id, i.issue_number, i.title, i.body, i.repository_name, i.author, i.created_at
       FROM issues i
       INNER JOIN item_involvement ii ON ii.item_id = i.id
       WHERE i.repository_name = ? AND ii.author = ? AND ii.item_type = 'issue'
       ORDER BY i.issue_number DESC`,
      [repositoryName, username],
    );

    return results.map((row: any) => ({
      id: row.id,
      issue_number: row.issue_number,
      title: row.title,
      body: row.body,
      repository_name: row.repository_name,
      author: row.author,
      created_at: row.created_at,
    }));
  } catch (error) {
    console.error('Error getting involved issues basic info:', error);
    throw error;
  }
}

// 特定ユーザーが関与したPull Requestの基本情報のみを取得
export async function getInvolvedPullRequestsBasicInfo(repositoryName: string, username: string) {
  const db = await getDbConnection();

  try {
    const results = await db.all(
      `SELECT DISTINCT pr.id, pr.pr_number, pr.title, pr.body, pr.repository_name, pr.author, pr.created_at
       FROM pull_requests pr
       INNER JOIN item_involvement ii ON ii.item_id = pr.id
       WHERE pr.repository_name = ? AND ii.author = ? AND ii.item_type = 'pull_request'
       ORDER BY pr.pr_number DESC`,
      [repositoryName, username],
    );

    return results.map((row: any) => ({
      id: row.id,
      pr_number: row.pr_number,
      title: row.title,
      body: row.body,
      repository_name: row.repository_name,
      author: row.author,
      created_at: row.created_at,
    }));
  } catch (error) {
    console.error('Error getting involved pull requests basic info:', error);
    throw error;
  }
}

// ユーザの特定のリポジトリにおける評価基準ごとの評価データと満点予測値を取得する関数
export async function getUserEvaluationsByCriteria(
  repositorySlug: string,
  authorUsername: string,
  criteriaName: string,
) {
  const db = await getDbConnection();

  try {
    const results = await db.all(
      `SELECT
         eval.evaluation_level,
         eval.reasoning,
         eval.evaluable,
         eval.surprise_flag,
         eval.incident_flag,
         eval.criteria_name,
         pred.predicted_max_score
       FROM item_evaluations AS eval
       LEFT JOIN pull_requests pr
         ON eval.item_type = 'pull_request' AND eval.item_id = pr.id
       LEFT JOIN issues iss
         ON eval.item_type = 'issue' AND eval.item_id = iss.id
       LEFT JOIN max_score_predictions pred
         ON pred.item_type = eval.item_type
        AND pred.repository_name = eval.repository_name
        AND pred.criteria_name = eval.criteria_name
        AND (
             (eval.item_type = 'pull_request' AND pred.item_number = pr.pr_number)
          OR (eval.item_type = 'issue'        AND pred.item_number = iss.issue_number)
        )
       WHERE eval.repository_name = ?
         AND eval.author = ?
         AND eval.criteria_name = ?
       ORDER BY eval.evaluated_at DESC`,
      [repositorySlug, authorUsername, criteriaName],
    );

    // 取得したデータを整形して返す
    return results.map((row) => ({
      level: row.evaluation_level,
      reasoning: row.reasoning,
      evaluable: row.evaluable === 1,
      surpriseFlag: row.surprise_flag === 1,
      incidentFlag: row.incident_flag === 1,
      predictedMaxScore: row.predicted_max_score,
    }));
  } catch (error) {
    console.error('Error getting combined user evaluations by criteria:', error);
    throw error;
  }
}

// 各評価基準ごとに、ユーザーが関与した各PR/Issueの「評価値」と「予測満点」を統合して取得
// 返却形式: { [criteriaName]: CriterionItemEvaluation[] }
export interface CriterionItemEvaluation {
  itemType: 'pull_request' | 'issue';
  itemNumber: number; // pr_number or issue_number
  title: string;
  evaluationLevel: number | null;
  evaluationReasoning: string | null;
  evidenceJson: string | null;
  evaluable: boolean;
  surpriseFlag: boolean;
  incidentFlag: boolean;
  predictedMaxScore: number | null;
  predictedReasoning: string | null;
}

export async function getUserCriterionItemEvaluationsWithPredictions(
  repositoryName: string,
  author: string,
): Promise<{ [criteriaName: string]: CriterionItemEvaluation[] }> {
  const db = await getDbConnection();
  try {
    const rows = await db.all(
      `SELECT
         eval.item_type,
         eval.item_id,
         eval.criteria_name,
         eval.evaluation_level,
         eval.reasoning AS evaluation_reasoning,
         eval.evidence_json,
         eval.evaluable,
         eval.surprise_flag,
         eval.incident_flag,
         pr.pr_number,
         pr.title AS pr_title,
         iss.issue_number,
         iss.title AS issue_title,
         pred.predicted_max_score,
         pred.reasoning AS predicted_reasoning
       FROM item_evaluations eval
       LEFT JOIN pull_requests pr
         ON eval.item_type = 'pull_request' AND eval.item_id = pr.id
       LEFT JOIN issues iss
         ON eval.item_type = 'issue' AND eval.item_id = iss.id
       LEFT JOIN max_score_predictions pred
         ON pred.item_type = eval.item_type
        AND pred.repository_name = eval.repository_name
        AND pred.criteria_name = eval.criteria_name
        AND (
             (eval.item_type = 'pull_request' AND pred.item_number = pr.pr_number)
          OR (eval.item_type = 'issue'        AND pred.item_number = iss.issue_number)
        )
       WHERE eval.repository_name = ?
         AND eval.author = ?
       ORDER BY eval.criteria_name, eval.item_type, eval.item_id DESC`,
      [repositoryName, author],
    );

    const grouped: { [criteriaName: string]: CriterionItemEvaluation[] } = {};
    for (const r of rows) {
      const itemType: 'pull_request' | 'issue' = r.item_type;
      const itemNumber = itemType === 'pull_request' ? r.pr_number : r.issue_number;
      if (itemNumber == null) continue;
      const title = itemType === 'pull_request' ? r.pr_title : r.issue_title;

      const entry: CriterionItemEvaluation = {
        itemType,
        itemNumber,
        title: title || '',
        evaluationLevel: r.evaluation_level ?? null,
        evaluationReasoning: r.evaluation_reasoning ?? null,
        evidenceJson: r.evidence_json ?? null,
        evaluable: r.evaluable === 1 || r.evaluable === true,
        surpriseFlag: r.surprise_flag === 1 || r.surprise_flag === true,
        incidentFlag: r.incident_flag === 1 || r.incident_flag === true,
        predictedMaxScore: r.predicted_max_score ?? null,
        predictedReasoning: r.predicted_reasoning ?? null,
      };
      (grouped[r.criteria_name] ||= []).push(entry);
    }

    return grouped;
  } catch (error) {
    console.error('Error getting user criterion item evaluations with predictions:', error);
    throw error;
  }
}

// ===== ability_summaries 関連 =====
export interface AbilitySummaryRow {
  repository_name: string;
  author: string;
  criteria_name: string;
  ability_score: number;
  summary_text: string;
  generated_at: string;
}

// ability_summaries へ推論結果を保存 / 更新
export async function saveAbilitySummary(params: {
  repositoryName: string;
  author: string;
  criteriaName: string;
  abilityScore: number;
  summaryText: string;
}): Promise<void> {
  const db = await getDbConnection();
  await db.run(
    `INSERT INTO ability_summaries (
       repository_name, author, criteria_name, ability_score, summary_text, generated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(repository_name, author, criteria_name) DO UPDATE SET
       ability_score = excluded.ability_score,
       summary_text = excluded.summary_text,
       generated_at = excluded.generated_at
    `,
    [params.repositoryName, params.author, params.criteriaName, params.abilityScore, params.summaryText],
  );
}

// ability_summaries 取得（著者＋リポジトリでまとめ）
export async function getAbilitySummariesByAuthor(
  repositoryName: string,
  author: string,
): Promise<AbilitySummaryRow[]> {
  const db = await getDbConnection();
  const rows = await db.all<AbilitySummaryRow[]>(
    `SELECT repository_name, author, criteria_name, ability_score, summary_text, generated_at
     FROM ability_summaries
     WHERE repository_name = ? AND author = ?
     ORDER BY criteria_name ASC`,
    [repositoryName, author],
  );
  return rows;
}

// slackのユーザ情報を保存 (schema: user_id, real_name, display_name)
export async function saveSlackUserInfo(userId: string, realName: string | null, displayName: string | null) {
  const db = await getDbConnection();
  await db.run(
    `INSERT INTO slack_users (user_id, real_name, display_name)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       real_name = COALESCE(excluded.real_name, slack_users.real_name),
       display_name = COALESCE(excluded.display_name, slack_users.display_name)
    `,
    [userId, realName, displayName],
  );
}

// slackのmessage送信履歴を保存
export async function saveSlackMessage(
  messageTs: string,
  threadTs: string | null,
  userId: string,
  text: string,
  channelId: string,
  postedAt: string,
  replyCount: number,
) {
  const db = await getDbConnection();
  await db.run(
    `INSERT INTO slack_messages (message_ts, thread_ts, user_id, text, channel_id, posted_at, reply_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_ts) DO UPDATE SET
       thread_ts = excluded.thread_ts,
       user_id = excluded.user_id,
       text = excluded.text,
       channel_id = excluded.channel_id, 
       posted_at = excluded.posted_at,
       reply_count = excluded.reply_count
    `,
    [messageTs, threadTs, userId, text, channelId, postedAt, replyCount],
  );
}

// ===== Bulk Slack Message Upsert =====
export interface SlackMessageRowForInsert {
  messageTs: string;
  threadTs: string | null;
  userId: string;
  text: string;
  channelId: string;
  postedAt: string;
  replyCount: number;
}

// slack_messages を1トランザクションでまとめてUPSERT
export async function saveSlackMessagesBulk(rows: SlackMessageRowForInsert[], options: { chunkSize?: number } = {}) {
  if (!rows.length) return;
  const chunkSize = options.chunkSize ?? 1000;
  const db = await getDbConnection();

  const sql = `
    INSERT INTO slack_messages (message_ts, thread_ts, user_id, text, channel_id, posted_at, reply_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_ts) DO UPDATE SET
      thread_ts = excluded.thread_ts,
      user_id = excluded.user_id,
      text = excluded.text,
      channel_id = excluded.channel_id,
      posted_at = excluded.posted_at,
      reply_count = excluded.reply_count
  `;

  // チャンク実行
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db.run('BEGIN');
    try {
      const stmt = await db.prepare(sql);
      try {
        for (const r of chunk) {
          await stmt.run(r.messageTs, r.threadTs, r.userId, r.text, r.channelId, r.postedAt, r.replyCount);
        }
      } finally {
        await stmt.finalize();
      }
      await db.run('COMMIT');
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
  }
}

// slackのユーザ情報を取得
export async function getSlackUserInfo(
  name: string,
): Promise<{ userId: string; realName: string | null; displayName: string | null } | null> {
  const db = await getDbConnection();
  const row = await db.get<{ userId: string; realName: string | null; displayName: string | null }>(
    `SELECT user_id AS userId, real_name AS realName, display_name AS displayName
     FROM slack_users
     WHERE real_name = ? OR display_name = ?
     LIMIT 1`,
    [name, name],
  );
  return row || null;
}

// slackの評価結果を保存
export async function saveSlackMessageEvaluation(params: {
  channelId: string;
  userId: string;
  criteriaName: string;
  evaluationLevel: number;
  reasoning: string;
  evidenceJson: string;
  evaluable: boolean;
  evaluatedAt?: string;
}) {
  const db = await getDbConnection();
  await db.run(
    `
    INSERT INTO slack_evaluation_results (
      channel_id, user_id, criteria_name, evaluation_level, reasoning, evidence_json, evaluable, evaluated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, user_id, criteria_name) DO UPDATE SET
      evaluation_level = excluded.evaluation_level,
      reasoning = excluded.reasoning,
      evidence_json = excluded.evidence_json,
      evaluable = excluded.evaluable,
      evaluated_at = excluded.evaluated_at
    `,
    [
      params.channelId,
      params.userId,
      params.criteriaName,
      params.evaluationLevel,
      params.reasoning,
      params.evidenceJson,
      params.evaluable,
      params.evaluatedAt || new Date().toISOString(),
    ],
  );
}

// slackのmessage送信履歴を取得
export async function getSlackMessagesByUser(userId: string): Promise<SlackMessageRowForInsert[]> {
  const db = await getDbConnection();
  const rows = await db.all<SlackMessageRowForInsert[]>(
    `SELECT message_ts AS messageTs, thread_ts AS threadTs, user_id AS userId, text, channel_id AS channelId, posted_at AS postedAt, reply_count AS replyCount
     FROM slack_messages
     WHERE user_id = ?
     ORDER BY posted_at DESC`,
    [userId],
  );
  return rows;
}

// 特定ユーザーの特定チャンネルでのメッセージを取得
export async function getSlackMessagesByUserAndChannel(
  userId: string,
  channelId: string,
): Promise<SlackMessageRowForInsert[]> {
  const db = await getDbConnection();
  const rows = await db.all<SlackMessageRowForInsert[]>(
    `SELECT message_ts AS messageTs, thread_ts AS threadTs, user_id AS userId, text, channel_id AS channelId, posted_at AS postedAt, reply_count AS replyCount
     FROM slack_messages
     WHERE user_id = ? AND channel_id = ?
     ORDER BY posted_at ASC`,
    [userId, channelId],
  );
  return rows;
}

// 特定ユーザーの全チャンネルでのSlack評価結果を取得
export async function getSlackEvaluationsByUser(userId: string) {
  const db = await getDbConnection();

  try {
    const results = await db.all(
      `SELECT
         channel_id,
         criteria_name,
         evaluation_level,
         reasoning,
         evidence_json,
         evaluable,
         evaluated_at
       FROM slack_evaluation_results
       WHERE user_id = ?
       ORDER BY criteria_name, channel_id, evaluated_at DESC`,
      [userId],
    );

    return results.map((row) => ({
      channelId: row.channel_id,
      criteriaName: row.criteria_name,
      evaluationLevel: row.evaluation_level,
      reasoning: row.reasoning,
      evidenceJson: row.evidence_json,
      evaluable: row.evaluable === 1,
      evaluatedAt: row.evaluated_at,
    }));
  } catch (error) {
    console.error('Error getting slack evaluations by user:', error);
    throw error;
  }
}

// Slack用のアビリティサマリーを保存
export async function saveSlackAbilitySummary(params: {
  userId: string;
  criteriaName: string;
  abilityScore: number;
  summaryText: string;
  channelIds: string[];
}): Promise<void> {
  const db = await getDbConnection();
  await db.run(
    `INSERT INTO slack_ability_summaries (
       user_id, criteria_name, ability_score, summary_text, channel_ids_json, generated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, criteria_name) DO UPDATE SET
       ability_score = excluded.ability_score,
       summary_text = excluded.summary_text,
       channel_ids_json = excluded.channel_ids_json,
       generated_at = excluded.generated_at
    `,
    [params.userId, params.criteriaName, params.abilityScore, params.summaryText, JSON.stringify(params.channelIds)],
  );
}

// Slack用のアビリティサマリーを取得
export async function getSlackAbilitySummariesByUser(userId: string): Promise<
  Array<{
    criteria_name: string;
    ability_score: number;
    summary_text: string;
    channel_ids: string[];
    generated_at: string;
  }>
> {
  const db = await getDbConnection();
  const rows = await db.all(
    `SELECT criteria_name, ability_score, summary_text, channel_ids_json, generated_at
     FROM slack_ability_summaries
     WHERE user_id = ?
     ORDER BY criteria_name ASC`,
    [userId],
  );

  return rows.map((row: any) => ({
    criteria_name: row.criteria_name,
    ability_score: row.ability_score,
    summary_text: row.summary_text,
    channel_ids: JSON.parse(row.channel_ids_json || '[]'),
    generated_at: row.generated_at,
  }));
}

// === Slack Thread Functions ===

// 特定スレッドの全メッセージを取得（thread_ts基準）
export async function getSlackMessagesByThread(
  channelId: string,
  threadTs: string,
): Promise<SlackMessageRowForInsert[]> {
  const db = await getDbConnection();
  const rows = await db.all<SlackMessageRowForInsert[]>(
    `SELECT message_ts AS messageTs, thread_ts AS threadTs, user_id AS userId, text, channel_id AS channelId, posted_at AS postedAt, reply_count AS replyCount
     FROM slack_messages
     WHERE channel_id = ? AND (message_ts = ? OR thread_ts = ?)
     ORDER BY posted_at ASC`,
    [channelId, threadTs, threadTs],
  );
  return rows;
}

// チャンネル内でユーザーが発言している全スレッドを取得
export async function getSlackThreadsByChannelAndUser(
  channelId: string,
  userId: string,
): Promise<
  Array<{
    threadTs: string;
    messageCount: number;
    userMessageCount: number;
    participants: string[];
    firstMessage: string;
  }>
> {
  const db = await getDbConnection();
  const rows = await db.all(
    `SELECT 
       COALESCE(thread_ts, message_ts) as threadTs,
       COUNT(*) as messageCount,
       COUNT(CASE WHEN user_id = ? THEN 1 END) as userMessageCount,
       GROUP_CONCAT(DISTINCT user_id) as userIds,
       MIN(text) as firstMessage
     FROM slack_messages
     WHERE channel_id = ?
     GROUP BY COALESCE(thread_ts, message_ts)
     HAVING userMessageCount > 0
     ORDER BY threadTs DESC`,
    [userId, channelId],
  );

  return rows.map((row: any) => ({
    threadTs: row.threadTs,
    messageCount: row.messageCount,
    userMessageCount: row.userMessageCount,
    participants: row.userIds ? row.userIds.split(',') : [],
    firstMessage: row.firstMessage || '',
  }));
}

// チャンネル内の全スレッドを取得（重複除去）- 既存の関数は互換性のため保持
export async function getSlackThreadsByChannel(channelId: string): Promise<
  Array<{
    threadTs: string;
    messageCount: number;
    participants: string[];
    firstMessage: string;
  }>
> {
  const db = await getDbConnection();
  const rows = await db.all(
    `SELECT 
       COALESCE(thread_ts, message_ts) as threadTs,
       COUNT(*) as messageCount,
       GROUP_CONCAT(DISTINCT user_id) as userIds,
       MIN(text) as firstMessage
     FROM slack_messages
     WHERE channel_id = ?
     GROUP BY COALESCE(thread_ts, message_ts)
     HAVING messageCount > 1
     ORDER BY threadTs DESC`,
    [channelId],
  );

  return rows.map((row: any) => ({
    threadTs: row.threadTs,
    messageCount: row.messageCount,
    participants: row.userIds ? row.userIds.split(',') : [],
    firstMessage: row.firstMessage || '',
  }));
}

// スレッドの最高点予測を保存
export async function saveSlackThreadMaxScorePrediction(params: {
  threadTs: string;
  channelId: string;
  criteriaName: string;
  predictedMaxScore: number;
  reasoning: string;
}): Promise<void> {
  const db = await getDbConnection();
  await db.run(
    `INSERT INTO slack_thread_max_scores (
       thread_ts, channel_id, criteria_name, predicted_max_score, reasoning, predicted_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(thread_ts, channel_id, criteria_name) DO UPDATE SET
       predicted_max_score = excluded.predicted_max_score,
       reasoning = excluded.reasoning,
       predicted_at = excluded.predicted_at
    `,
    [params.threadTs, params.channelId, params.criteriaName, params.predictedMaxScore, params.reasoning],
  );
}

// スレッドの最高点予測を取得
export async function getSlackThreadMaxScorePredictions(
  threadTs: string,
  channelId: string,
): Promise<{ [criteriaName: string]: number }> {
  const db = await getDbConnection();
  const results = await db.all(
    `SELECT criteria_name, predicted_max_score FROM slack_thread_max_scores 
     WHERE thread_ts = ? AND channel_id = ?`,
    [threadTs, channelId],
  );

  const predictions: { [criteriaName: string]: number } = {};
  for (const result of results) {
    predictions[result.criteria_name] = result.predicted_max_score;
  }

  return predictions;
}

// スレッドのユーザー評価を保存
export async function saveSlackThreadUserEvaluation(params: {
  threadTs: string;
  channelId: string;
  userId: string;
  criteriaName: string;
  evaluationLevel: number;
  reasoning: string;
  evidenceJson: string;
  evaluable: boolean;
  surpriseFlag?: boolean;
  incidentFlag?: boolean;
}): Promise<void> {
  const db = await getDbConnection();
  await db.run(
    `INSERT INTO slack_thread_user_evaluations (
       thread_ts, channel_id, user_id, criteria_name, evaluation_level, 
       reasoning, evidence_json, evaluable, surprise_flag, incident_flag, evaluated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(thread_ts, channel_id, user_id, criteria_name) DO UPDATE SET
       evaluation_level = excluded.evaluation_level,
       reasoning = excluded.reasoning,
       evidence_json = excluded.evidence_json,
       evaluable = excluded.evaluable,
       surprise_flag = excluded.surprise_flag,
       incident_flag = excluded.incident_flag,
       evaluated_at = excluded.evaluated_at
    `,
    [
      params.threadTs,
      params.channelId,
      params.userId,
      params.criteriaName,
      params.evaluationLevel,
      params.reasoning,
      params.evidenceJson,
      params.evaluable,
      params.surpriseFlag ?? false,
      params.incidentFlag ?? false,
    ],
  );
}

// 複数のスレッド評価結果をまとめて保存
export async function saveSlackThreadUserEvaluations(
  threadTs: string,
  channelId: string,
  username: string,
  evaluations: Array<{
    criteria: string;
    level: number;
    reasoning: string;
    evidence: string | string[];
    evaluable?: boolean;
    surpriseFlag?: boolean;
    incidentFlag?: boolean;
  }>,
): Promise<void> {
  const userInfo = await getSlackUserInfo(username);
  if (!userInfo) {
    throw new Error(`Slack user not found: ${username}`);
  }

  const promises = evaluations.map(async (evaluation) => {
    const evidenceJson = Array.isArray(evaluation.evidence) ? evaluation.evidence.join(', ') : evaluation.evidence;

    return saveSlackThreadUserEvaluation({
      threadTs,
      channelId,
      userId: userInfo.userId,
      criteriaName: evaluation.criteria,
      evaluationLevel: evaluation.level,
      reasoning: evaluation.reasoning,
      evidenceJson,
      evaluable: evaluation.evaluable ?? true,
      surpriseFlag: evaluation.surpriseFlag ?? false,
      incidentFlag: evaluation.incidentFlag ?? false,
    });
  });

  await Promise.all(promises);
}

// ユーザーのスレッド評価結果を取得（特定評価基準）
export async function getSlackThreadEvaluationsByUserAndCriteria(
  userId: string,
  criteriaName: string,
  channelIds?: string[],
): Promise<
  Array<{
    threadTs: string;
    channelId: string;
    evaluationLevel: number;
    reasoning: string;
    evidenceJson: string;
    evaluable: boolean;
    predictedMaxScore: number | null;
    evaluatedAt: string;
  }>
> {
  const db = await getDbConnection();

  let query = `SELECT 
         eval.thread_ts,
         eval.channel_id,
         eval.evaluation_level,
         eval.reasoning,
         eval.evidence_json,
         eval.evaluable,
         eval.evaluated_at,
         pred.predicted_max_score
       FROM slack_thread_user_evaluations eval
       LEFT JOIN slack_thread_max_scores pred
         ON pred.thread_ts = eval.thread_ts
        AND pred.channel_id = eval.channel_id
        AND pred.criteria_name = eval.criteria_name
       WHERE eval.user_id = ? AND eval.criteria_name = ?`;

  const params: any[] = [userId, criteriaName];

  if (channelIds && channelIds.length > 0) {
    const placeholders = channelIds.map(() => '?').join(',');
    query += ` AND eval.channel_id IN (${placeholders})`;
    params.push(...channelIds);
  }

  query += ` ORDER BY eval.evaluated_at DESC`;

  const results = await db.all(query, params);

  return results.map((row: any) => ({
    threadTs: row.thread_ts,
    channelId: row.channel_id,
    evaluationLevel: row.evaluation_level,
    reasoning: row.reasoning,
    evidenceJson: row.evidence_json,
    evaluable: row.evaluable === 1,
    predictedMaxScore: row.predicted_max_score,
    evaluatedAt: row.evaluated_at,
  }));
}
