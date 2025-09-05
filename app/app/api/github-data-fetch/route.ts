import { type NextRequest, NextResponse } from 'next/server';
import {
  type IssueData,
  saveIssue,
  saveIssueComment,
  savePullRequest,
  savePullRequestComment,
} from '../../../lib/github-db';
import type { AnalyzerRequest, IssueAnalysisResult, ProcessedIssue } from '../../../types';

export async function POST(request: NextRequest) {
  try {
    const { owner, repo, author }: AnalyzerRequest = await request.json();

    if (!owner || !repo || !author) {
      return NextResponse.json({ error: 'Owner, repo, and author are required' }, { status: 400 });
    }

    const headers = {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    };

    const allIssues = [];
    let page = 1;
    const perPage = 100;
    let hasNextPage = true;

    // Fetch all issues
    while (hasNextPage) {
      const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=${perPage}&page=${page}`;
      const apiResponse = await fetch(url, { headers });
      if (!apiResponse.ok) {
        throw new Error(`GitHub API Error: ${apiResponse.status} ${await apiResponse.text()}`);
      }

      const response = await apiResponse.json();
      allIssues.push(...response);

      const linkHeader = apiResponse.headers.get('Link');
      hasNextPage = linkHeader?.includes('rel="next"') ?? false;

      console.log(`Fetched page ${page}. Has next page: ${hasNextPage}`);
      page++;
    }

    // Separate issues and pull requests
    const issuesOnly = allIssues.filter((item) => !item.pull_request);
    const pullRequestsOnly = allIssues.filter((item) => item.pull_request);

    const totalIssuesCount = issuesOnly.length;
    const totalPRsCount = pullRequestsOnly.length;
    console.log(`Found ${totalIssuesCount} issues and ${totalPRsCount} pull requests total.`);

    const repositoryName = `${owner}/${repo}`;

    // Save Issues
    console.log('Saving issues (without comments) ...');
    for (const issue of issuesOnly) {
      const issueData: IssueData = {
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body || '',
        repositoryName,
        author: issue.user?.login,
        createdAt: issue.created_at,
      };
      await saveIssue(issueData);
    }

    // Save Pull Requests
    console.log('Saving pull requests (without comments) ...');
    for (const pr of pullRequestsOnly) {
      const prData = {
        prNumber: pr.number,
        title: pr.title,
        body: pr.body || '',
        repositoryName,
        author: pr.user?.login,
        createdAt: pr.created_at,
      };
      await savePullRequest(prData);
    }

    // コメントを個別に取得して保存 (Issues and PRs comments)
    const allComments = [];

    // Reset pagination variables for comments
    let commentPage = 1;
    let commentHasNextPage = true;

    // Fetch all issues/PR comments
    while (commentHasNextPage) {
      const url = `https://api.github.com/repos/${owner}/${repo}/issues/comments?per_page=${perPage}&page=${commentPage}`;
      const apiResponse = await fetch(url, { headers });
      if (!apiResponse.ok) {
        throw new Error(`GitHub API Error: ${apiResponse.status} ${await apiResponse.text()}`);
      }

      const response = await apiResponse.json();
      allComments.push(...response);

      const linkHeader = apiResponse.headers.get('Link');
      commentHasNextPage = linkHeader?.includes('rel="next"') ?? false;

      console.log(`Fetched comments page ${commentPage}. Has next page: ${commentHasNextPage}`);
      commentPage++;
    }

    const totalCommentsCount = allComments.length;
    console.log(`Found ${totalCommentsCount} comments total.`);

    // Separate issue comments and PR comments
    const issueNumbers = new Set(issuesOnly.map((issue) => issue.number));
    const prNumbers = new Set(pullRequestsOnly.map((pr) => pr.number));

    for (const comment of allComments) {
      const itemNumber = comment.issue_url ? parseInt(comment.issue_url.split('/').pop() || '0') : 0;

      if (issueNumbers.has(itemNumber)) {
        // This is an issue comment
        const commentData = {
          commentId: comment.id,
          issueId: itemNumber,
          body: comment.body || '',
          userName: comment.user?.login || '',
          createdAt: comment.created_at,
          repositoryName,
        };
        await saveIssueComment(commentData);
      } else if (prNumbers.has(itemNumber)) {
        // This is a PR comment
        const commentData = {
          commentId: comment.id,
          prId: itemNumber,
          body: comment.body || '',
          userName: comment.user?.login || '',
          createdAt: comment.created_at,
          repositoryName,
        };
        await savePullRequestComment(commentData);
      }
    }

    const processedIssues: ProcessedIssue[] = issuesOnly.map((issue) => ({
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body || '',
      issueUser: issue.user?.login || '',
    }));

    const result: IssueAnalysisResult = {
      total_count: totalIssuesCount,
      issues: processedIssues,
    };

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Issue analysis error:', error);
    return NextResponse.json({ error }, { status: 500 });
  }
}
