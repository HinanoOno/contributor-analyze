import { type NextRequest, NextResponse } from 'next/server';
import { getAllIssues, getAllPullRequests, getIssuesByAuthor, getPullRequestsByAuthor } from '../../../lib/github-db';
import type { AnalyzerRequest } from '../../../types';

export async function GET() {
  try {
    const [pullRequests, issues] = await Promise.all([getAllPullRequests(), getAllIssues()]);
    return NextResponse.json({ pullRequests, issues });
  } catch (error) {
    console.error('Get all data error:', error);
    return NextResponse.json({ error: 'Failed to retrieve all data' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { owner, repo, author }: AnalyzerRequest = await request.json();

    if (!owner || !repo || !author) {
      return NextResponse.json({ error: 'Owner, repo, and author are required' }, { status: 400 });
    }

    const repositoryName = `${owner}/${repo}`;

    // 新しいDB構造からデータを取得
    const [pullRequests, issues] = await Promise.all([
      getPullRequestsByAuthor(repositoryName, author).catch(() => []),
      getIssuesByAuthor(repositoryName, author).catch(() => []),
    ]);

    // 既存のレスポンス形式に合わせて変換
    const prData =
      pullRequests.length > 0
        ? {
            data: {
              total_count: pullRequests.length,
              pull_requests: pullRequests.map((pr) => ({
                prNumber: pr.pr_number,
                prTitle: pr.title,
                prBody: pr.body,
                comments: pr.comments.map((c: any) => ({
                  body: c.body,
                  userLogin: c.user_name,
                })),
              })),
            },
          }
        : null;

    const issueData =
      issues.length > 0
        ? {
            data: {
              total_count: issues.length,
              issues: issues.map((issue) => ({
                issueNumber: issue.issue_number,
                issueTitle: issue.title,
                issueBody: issue.body,
                issueUser: issue.author,
                comments: issue.comments.map((c: any) => ({
                  body: c.body,
                  userLogin: c.user_name,
                })),
              })),
            },
          }
        : null;

    return NextResponse.json({
      success: true,
      data: {
        pullRequests: prData,
        issues: issueData,
        repositorySlug: repositoryName,
        author,
      },
    });
  } catch (error) {
    console.error('Display data error:', error);
    return NextResponse.json({ error: 'Failed to retrieve data' }, { status: 500 });
  }
}
