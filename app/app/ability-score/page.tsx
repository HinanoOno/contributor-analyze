'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SingleAbilityChart, RadarAbilityChart } from '@/components/AbilityChart';

interface AbilityScoreResponse {
  success: boolean;
  authorUsername: string;
  repositorySlug: string;
  abilityScores: Record<string, { score: number; confidenceInterval: { lower: number; upper: number } }>;
  averageScore: number;
  criteriaCount: number;
  calculatedAt: string;
}

interface AbilityScoreError {
  error: string;
}

export default function AbilityScorePage() {
  const [selectedRepo, setSelectedRepo] = useState('');
  const [username, setUsername] = useState('');
  const [results, setResults] = useState<AbilityScoreResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'github' | 'slack'>('github');

  useEffect(() => {
    const storedMode = localStorage.getItem('app-mode');
    if (storedMode === 'slack' || storedMode === 'github') {
      setTab(storedMode);
    }
  }, []);

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !username.trim()) return;

    setLoading(true);
    setResults(null);
    setError('');
    setSummary([]);
    setSummaryLoading(true);

    try {
      const response = await fetch('/api/ability-score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repositorySlug: selectedRepo,
          authorUsername: username.trim(),
        }),
      });

      const data = await response.json();
      console.log(data);

      if (data.success) {
        setResults(data);
      } else {
        setError(data.error || '不明なエラーが発生しました');
      }
    } catch (error) {
      setError('アビリティスコア計算リクエストでエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSelectedRepo('');
    setUsername('');
    setResults(null);
    setError('');
    setSummary([]);
    setSummaryLoading(false);
  };

  const getScoreColor = (score: number): string => {
    if (score >= 3) return 'text-green-600';
    if (score >= 2) return 'text-yellow-600';
    if (score >= 1) return 'text-orange-600';
    return 'text-red-600';
  };

  const getScoreLabel = (score: number): string => {
    if (score >= 3) return '優秀';
    if (score >= 2) return '良好';
    if (score >= 1) return '標準';
    return '要改善';
  };

  // 要約分の取得
  const [summary, setSummary] = useState<Array<{ criteria_name: string; evaluation_level: number; summary: string }>>(
    [],
  );
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Slackスレッド要約の状態
  const [slackThreadSummary, setSlackThreadSummary] = useState<
    Array<{ criteria_name: string; evaluation_level: number; summary: string }>
  >([]);
  const [slackThreadSummaryLoading, setSlackThreadSummaryLoading] = useState(false);
  const [slackThreadUsername, setSlackThreadUsername] = useState('');
  const [slackThreadChannelIds, setSlackThreadChannelIds] = useState('');
  const [slackThreadResults, setSlackThreadResults] = useState<any>(null);
  const [slackThreadError, setSlackThreadError] = useState('');

  useEffect(() => {
    if (results) {
      fetchAbilitySummary(selectedRepo, username.trim());
    } else {
      setSummary([]);
    }
  }, [results]);

  const fetchAbilitySummary = async (repositorySlug: string, authorUsername: string) => {
    setSummaryLoading(true);
    try {
      const response = await fetch('/api/ability-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repositorySlug, username: authorUsername }),
      });

      const data = await response.json();
      console.log('Ability summary response:', data);
      if (data.success) {
        setSummary(data.summary || []);
      } else {
        console.error('Error fetching ability summary:', data.error);
        setSummary([]);
      }
    } catch (error) {
      console.error('Error fetching ability summary:', error);
      setSummary([]);
    } finally {
      setSummaryLoading(false);
    }
  };

  // Slackスレッド能力値計算
  const handleSlackThreadCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slackThreadUsername.trim() || !slackThreadChannelIds.trim()) return;

    setSlackThreadSummaryLoading(true);
    setSlackThreadResults(null);
    setSlackThreadError('');
    setSlackThreadSummary([]);

    try {
      const channelIdArray = slackThreadChannelIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id);

      const response = await fetch('/api/slack-thread-ability-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: slackThreadUsername.trim(),
          channelIds: channelIdArray,
        }),
      });

      const data = await response.json();
      console.log('Slack thread ability summary data:', data);

      if (data.success) {
        setSlackThreadSummary(data.summary || []);
        // 能力値スコア形式に変換してレーダーチャート用に設定
        const abilityScores: Record<string, { score: number; confidenceInterval: { lower: number; upper: number } }> =
          {};
        data.summary?.forEach((item: any) => {
          abilityScores[item.criteria_name] = {
            score: item.evaluation_level,
            confidenceInterval: { lower: item.evaluation_level - 0.5, upper: item.evaluation_level + 0.5 },
          };
        });

        setSlackThreadResults({
          success: true,
          authorUsername: slackThreadUsername,
          abilityScores,
          averageScore:
            data.summary?.reduce((sum: number, item: any) => sum + item.evaluation_level, 0) /
            (data.summary?.length || 1),
          criteriaCount: data.summary?.length || 0,
          calculatedAt: new Date().toISOString(),
        });
      } else {
        setSlackThreadError(data.error || '不明なエラーが発生しました');
      }
    } catch (error) {
      setSlackThreadError('Slackスレッド能力サマリー取得でエラーが発生しました');
    } finally {
      setSlackThreadSummaryLoading(false);
    }
  };

  const handleSlackThreadClear = () => {
    setSlackThreadUsername('');
    setSlackThreadChannelIds('');
    setSlackThreadResults(null);
    setSlackThreadError('');
    setSlackThreadSummary([]);
  };

  return (
    <>
      {/* タブ切替ボタン*/}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setTab('slack')}
          className={`px-3 py-1 rounded ${tab === 'slack' ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}
        >
          Slack
        </button>
        <button
          type="button"
          onClick={() => setTab('github')}
          className={`px-3 py-1 rounded ${tab === 'github' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          GitHub
        </button>
      </div>

      {tab === 'github' ? (
        <div className="container mx-auto p-4">
          <h1 className="text-2xl font-bold mb-6">能力計算</h1>

          <div className="mb-4 p-4 bg-blue-50 rounded-md">
            <p className="text-sm text-blue-800">
              このページでは、エンジニアの能力を計算します。
              各評価基準について、過去の評価データを基にスキル能力を算出します。
            </p>
          </div>

          <form onSubmit={handleCalculate} className="space-y-4 mb-6">
            <div>
              <label htmlFor="repository" className="block text-sm font-medium mb-2">
                リポジトリ（owner/repo）:
              </label>
              <input
                type="text"
                id="repository"
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                placeholder="例: vercel/next.js"
                className="w-full p-2 border border-gray-300 rounded-md"
                required
              />
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-2">
                ユーザー名:
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="GitHubユーザー名を入力"
                className="w-full p-2 border border-gray-300 rounded-md"
                required
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? '計算中...' : 'スコア計算'}
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

          {error && (
            <div className="border border-red-300 bg-red-50 rounded-md p-4 mb-6">
              <h2 className="text-xl font-semibold text-red-800 mb-3">エラー</h2>
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {results && (
            <div className="border border-gray-300 rounded-md p-4">
              <h2 className="text-xl font-semibold mb-4">{results.authorUsername} のアビリティスコア結果</h2>

              <div className="mb-6 p-4 bg-gray-50 rounded-md">
                <h3 className="text-lg font-medium mb-2">全項目レーダーチャート</h3>
                <RadarAbilityChart
                  scores={Object.entries(results.abilityScores).map(([criteria, d]) => ({
                    criteria,
                    score: d.score,
                    confidenceInterval: d.confidenceInterval,
                  }))}
                  maxScale={4}
                />
                <div className="text-xs text-gray-600 mt-3 text-right">
                  {results.criteriaCount} 項目 | 計算日時: {new Date(results.calculatedAt).toLocaleString('ja-JP')}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-lg font-medium mb-3">評価基準別スコア</h3>
                {summaryLoading && (
                  <div className="flex items-center gap-2 text-xs text-blue-600 mb-2" role="status" aria-live="polite">
                    <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                    <span>要約生成中…</span>
                  </div>
                )}
                {Object.entries(results.abilityScores).map(([criteria, scoreData]) => (
                  <div
                    key={criteria}
                    className="flex justify-between items-center p-3 bg-white border border-gray-200 rounded-md"
                  >
                    <span className="font-medium text-sm">{criteria}</span>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className={`text-lg font-bold ${getScoreColor(scoreData.score)}`}>
                          {scoreData.score.toFixed(1)}
                        </span>
                        <span className={`ml-2 text-xs ${getScoreColor(scoreData.score)}`}>
                          ({getScoreLabel(scoreData.score)})
                        </span>
                      </div>
                      <div>
                        <SingleAbilityChart
                          criteria={criteria}
                          score={scoreData.score}
                          confidenceInterval={scoreData.confidenceInterval}
                        />
                      </div>
                      <div className="w-80 text-xs text-gray-600">
                        {summaryLoading ? (
                          <div className="animate-pulse bg-gray-200 h-4 w-full rounded"></div>
                        ) : summary.find((s) => s.criteria_name === criteria) ? (
                          <p className="text-left">{summary.find((s) => s.criteria_name === criteria)?.summary}</p>
                        ) : (
                          <p className="text-gray-400 italic">十分なデータがありません</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="container mx-auto p-4">
          <h1 className="text-2xl font-bold mb-6">Slack能力分析</h1>

          <div className="mb-4 p-4 bg-purple-50 rounded-md">
            <p className="text-sm text-purple-800">
              このページでは、Slackのスレッド評価データに基づいてエンジニアの能力を分析します。
              各評価基準ごとの詳細なサマリーと最高点予測に基づいた精密な能力値を表示します。
            </p>
          </div>

          <form onSubmit={handleSlackThreadCalculate} className="space-y-4 mb-6">
            <div>
              <label htmlFor="slackThreadUsername" className="block text-sm font-medium mb-2">
                Slackユーザー名:
              </label>
              <input
                type="text"
                id="slackThreadUsername"
                value={slackThreadUsername}
                onChange={(e) => setSlackThreadUsername(e.target.value)}
                placeholder="Slackユーザー名を入力"
                className="w-full p-2 border border-gray-300 rounded-md"
                disabled={slackThreadSummaryLoading}
                required
              />
            </div>

            <div>
              <label htmlFor="slackThreadChannelIds" className="block text-sm font-medium mb-2">
                チャンネルID (カンマ区切り):
              </label>
              <input
                type="text"
                id="slackThreadChannelIds"
                value={slackThreadChannelIds}
                onChange={(e) => setSlackThreadChannelIds(e.target.value)}
                placeholder="C1234567890,C0987654321"
                className="w-full p-2 border border-gray-300 rounded-md"
                disabled={slackThreadSummaryLoading}
                required
              />
              <p className="text-xs text-gray-600 mt-1">
                スレッド評価データがあるチャンネルIDをカンマで区切って入力してください
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={slackThreadSummaryLoading}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                {slackThreadSummaryLoading ? '分析中...' : 'スコア計算'}
              </button>
              <button
                type="button"
                onClick={handleSlackThreadClear}
                className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
              >
                クリア
              </button>
            </div>
          </form>

          {slackThreadError && (
            <div className="border border-red-300 bg-red-50 rounded-md p-4 mb-6">
              <h2 className="text-xl font-semibold text-red-800 mb-3">エラー</h2>
              <p className="text-red-700">{slackThreadError}</p>
            </div>
          )}

          {slackThreadSummaryLoading && (
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mr-4"></div>
                <p className="text-gray-700">Slackスレッド能力値を分析中です。しばらくお待ちください...</p>
              </div>
            </div>
          )}

          {slackThreadResults && (
            <div className="border border-gray-300 rounded-md p-4">
              <h2 className="text-xl font-semibold mb-4">
                {slackThreadResults.authorUsername} のSlackスレッド能力分析結果
              </h2>

              <div className="mb-6 p-4 bg-gray-50 rounded-md">
                <h3 className="text-lg font-medium mb-2">全項目レーダーチャート</h3>
                <RadarAbilityChart
                  scores={Object.entries(slackThreadResults.abilityScores).map(([criteria, d]) => ({
                    criteria,
                    score: d.score,
                    confidenceInterval: d.confidenceInterval,
                  }))}
                  maxScale={4}
                />
                <div className="text-xs text-gray-600 mt-3 text-right">
                  {slackThreadResults.criteriaCount} 項目 | 分析日時:{' '}
                  {new Date(slackThreadResults.calculatedAt).toLocaleString('ja-JP')}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-lg font-medium mb-3">評価基準別スレッド分析結果</h3>
                {Object.entries(slackThreadResults.abilityScores).map(([criteria, scoreData]) => (
                  <div
                    key={criteria}
                    className="flex justify-between items-center p-3 bg-white border border-gray-200 rounded-md"
                  >
                    <span className="font-medium text-sm">{criteria}</span>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className={`text-lg font-bold ${getScoreColor(scoreData.score)}`}>
                          {scoreData.score.toFixed(1)}
                        </span>
                        <span className={`ml-2 text-xs ${getScoreColor(scoreData.score)}`}>
                          ({getScoreLabel(scoreData.score)})
                        </span>
                      </div>
                      <div>
                        <SingleAbilityChart
                          criteria={criteria}
                          score={scoreData.score}
                          confidenceInterval={scoreData.confidenceInterval}
                        />
                      </div>
                      <div className="w-80 text-xs text-gray-600">
                        {slackThreadSummary.find((s) => s.criteria_name === criteria) ? (
                          <p className="text-left">
                            {slackThreadSummary.find((s) => s.criteria_name === criteria)?.summary}
                          </p>
                        ) : (
                          <p className="text-gray-400 italic">十分なデータがありません</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
