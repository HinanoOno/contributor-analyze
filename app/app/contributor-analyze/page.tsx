'use client';

import { useEffect, useState } from 'react';
import MarkdownRenderer from '../../components/MarkdownRenderer';

interface RepositoryData {
  repositorySlug: string;
  dataType: string;
  fetchedAt: string;
}

export default function ContributorAnalyzePage() {
  const [selectedRepo, setSelectedRepo] = useState('');
  const [username, setUsername] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [evaluateIndividually, setEvaluateIndividually] = useState(false);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !username.trim()) return;

    setLoading(true);
    setAnalysis('');

    try {
      const response = await fetch('/api/contributor-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repositorySlug: selectedRepo,
          username: username.trim(),
          evaluateIndividually,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.mode === 'individual') {
          // 個別評価結果の表示
          const summary = data.summary;
          const results = data.results;

          let resultText = `## 個別評価結果\n\n**サマリー:**\n- 総数: ${summary.total}\n- 成功: ${summary.successful}\n- 失敗: ${summary.failed}\n\n**詳細結果:**\n\n`;

          results.forEach((result: any) => {
            if (result.success) {
              resultText += `### ${result.type === 'pull_request' ? 'PR' : 'Issue'} #${result.number}: ${result.title}\n`;
              resultText += `✅ 評価完了\n\n`;
            } else {
              resultText += `### ${result.type === 'pull_request' ? 'PR' : 'Issue'} #${result.number}: ${result.title}\n`;
              resultText += `❌ 評価失敗: ${result.error}\n\n`;
            }
          });

          setAnalysis(resultText);
        } else {
          // 従来の統合評価結果
          setAnalysis(data.evaluation);
        }
      } else {
        setAnalysis(`エラー: ${data.error}`);
      }
    } catch (error) {
      setAnalysis('分析リクエストでエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSelectedRepo('');
    setUsername('');
    setAnalysis('');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">GitHubコントリビューター評価</h1>
        <p className="mb-6 text-gray-600 text-sm">PR/Issueの活動データに基づき、各評価基準での能力を推定します。</p>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-base font-semibold leading-6 text-gray-900">評価条件</h2>
            <p className="mt-0.5 text-xs text-gray-500">対象リポジトリとユーザーを指定してください。</p>
          </div>
          <form onSubmit={handleAnalyze} className="p-4 space-y-4">
            <div>
              <label htmlFor="repository" className="block text-sm font-medium text-gray-700 mb-1">
                リポジトリ（owner/repo）
              </label>
              <input
                type="text"
                id="repository"
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                placeholder="例: vercel/next.js"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                ユーザー名
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="GitHubユーザー名を入力"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                required
              />
              <p className="text-xs text-gray-500 mt-1">対象ユーザーのログイン名を入力してください</p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={evaluateIndividually}
                  onChange={(e) => setEvaluateIndividually(e.target.checked)}
                  className="w-4 h-4"
                />
                個別評価モード（各PR/Issueを個別に評価して保存）
              </label>
              {evaluateIndividually && (
                <p className="text-xs text-gray-600 mt-1">
                  ⚠️ 時間がかかる場合があります（API制限により待機時間あり）。
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? '分析中...' : '分析実行'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
              >
                クリア
              </button>
            </div>
          </form>
        </div>

        {analysis && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mt-4 p-4">
            <h2 className="text-base font-semibold leading-6 text-gray-900 mb-3">分析結果</h2>
            <div className="prose max-w-none">
              <MarkdownRenderer content={analysis} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
