'use client';

import { useState } from 'react';
import { API_CONSTANTS, UI_CONSTANTS } from '../../config/constants';

export default function MaxScorePredictionPage() {
  const [repositoryName, setRepositoryName] = useState('');
  const [user, setUser] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repositoryName.trim()) {
      setError(UI_CONSTANTS.ERROR_MESSAGES.REQUIRED_FIELD);
      return;
    }
    if (!user.trim()) {
      setError('ユーザー名は必須です');
      return;
    }
    setIsLoading(true);
    setError('');
    setResults(null);

    try {
      const response = await fetch('/api/max-score-prediction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repositoryName: repositoryName.trim(),
          user: user.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '予測処理でエラーが発生しました');
      }

      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">満点予測システム</h1>

        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="repositoryName" className="block text-sm font-medium text-gray-700 mb-2">
                リポジトリ名
              </label>
              <input
                type="text"
                id="repositoryName"
                value={repositoryName}
                onChange={(e) => setRepositoryName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: tiangolo/fastapi"
                disabled={isLoading}
              />
            </div>
            <div>
              <label htmlFor="user" className="block text-sm font-medium text-gray-700 mb-2">
                ユーザー名（GitHub）
              </label>
              <input
                type="text"
                id="user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: octocat"
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isLoading ? '予測実行中...' : '満点予測を実行'}
            </button>
          </form>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-800">{error}</p>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-4"></div>
              <p className="text-gray-700">満点予測を実行中です。しばらくお待ちください...</p>
            </div>
          </div>
        )}

        {results && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">ユーザー別 満点予測結果</h2>
            <p className="text-sm text-gray-600 mb-4">
              リポジトリ: <span className="font-medium">{results.repositoryName}</span> / ユーザー:{' '}
              <span className="font-medium">{results.user}</span> / 対象アイテム数:{' '}
              <span className="font-medium">{results.itemCount}</span>
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      タイプ
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      番号
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      タイトル
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.results.map((row: any, idx: number) => (
                    <tr key={idx} className="align-top">
                      <td className="px-4 py-2 text-sm text-gray-900 whitespace-nowrap">
                        {row.itemType === 'pull_request' ? 'PR' : 'Issue'}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-900 whitespace-nowrap">#{row.itemNumber}</td>
                      <td className="px-4 py-2 text-sm text-gray-900 max-w-xs truncate" title={row.title}>
                        {row.title}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="mt-4">
          <a
            href="/contributor-analyze"
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
          >
            ContributorAnalyzePage
          </a>
        </div>
      </div>
    </div>
  );
}
