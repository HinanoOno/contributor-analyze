'use client';

import { useState } from 'react';

export default function SlackThreadEvaluationPage() {
  const [username, setUsername] = useState('');
  const [channelIds, setChannelIds] = useState('');
  const [threadTs, setThreadTs] = useState('');
  const [channelId, setChannelId] = useState('');
  const [evaluationMode, setEvaluationMode] = useState<'specific' | 'multi'>('multi');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    if (evaluationMode === 'specific' && (!threadTs.trim() || !channelId.trim())) {
      setError('特定スレッド評価にはスレッドTSとチャンネルIDが必要です');
      return;
    }

    if (evaluationMode === 'multi' && !channelIds.trim()) {
      setError('複数チャンネル評価にはチャンネルIDが必要です');
      return;
    }

    setLoading(true);
    setResults(null);
    setError('');

    try {
      const requestBody = {
        username: username.trim(),
        ...(evaluationMode === 'specific'
          ? {
              threadTs: threadTs.trim(),
              channelId: channelId.trim(),
            }
          : {
              channelIds: channelIds
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id),
            }),
      };

      const response = await fetch('/api/slack-thread-evaluation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (data.success) {
        setResults(data);
      } else {
        setError(data.error || 'スレッド評価に失敗しました');
      }
    } catch (error) {
      setError('エラーが発生しました。もう一度お試しください。');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setUsername('');
    setChannelIds('');
    setThreadTs('');
    setChannelId('');
    setResults(null);
    setError('');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Slackスレッド評価</h1>
        <p className="mb-6 text-gray-600 text-sm">スレッド単位で最高点予測とユーザー評価を実行し、結果を保存します。</p>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold leading-6 text-gray-900">評価条件</h2>
              <p className="mt-0.5 text-xs text-gray-500">対象ユーザーとスレッド範囲を指定してください。</p>
            </div>
          </div>
          <form className="p-4 space-y-6" onSubmit={handleSubmit}>
            {/* 評価モード選択 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">評価モード</label>
              <div className="inline-flex rounded-md border border-neutral-300 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setEvaluationMode('multi')}
                  className={[
                    'px-3 py-1.5',
                    evaluationMode === 'multi'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white text-neutral-800 hover:bg-neutral-50',
                  ].join(' ')}
                >
                  複数チャンネル（推奨）
                </button>
                <button
                  type="button"
                  onClick={() => setEvaluationMode('specific')}
                  className={[
                    'px-3 py-1.5 border-l border-neutral-300',
                    evaluationMode === 'specific'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white text-neutral-800 hover:bg-neutral-50',
                  ].join(' ')}
                >
                  特定スレッド
                </button>
              </div>
            </div>

            {/* ユーザー名 */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                Slackユーザー名
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                placeholder="例: taro.yamada"
                disabled={loading}
                required
              />
              <p className="text-xs text-gray-500 mt-1">display_name または real_name と一致する必要があります</p>
            </div>

            {/* 複数チャンネル評価の場合 */}
            {evaluationMode === 'multi' && (
              <div>
                <label htmlFor="channelIds" className="block text-sm font-medium text-gray-700">
                  チャンネルID（カンマ区切り）
                </label>
                <input
                  type="text"
                  id="channelIds"
                  value={channelIds}
                  onChange={(e) => setChannelIds(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                  placeholder="例: C1234567890,C0987654321"
                  disabled={loading}
                  required
                />
                <p className="text-xs text-gray-600 mt-1">
                  各チャンネルのスレッドのうち、ユーザーが参加したものを評価します
                </p>
              </div>
            )}

            {/* 特定スレッド評価の場合 */}
            {evaluationMode === 'specific' && (
              <>
                <div>
                  <label htmlFor="channelId" className="block text-sm font-medium text-gray-700">
                    チャンネルID
                  </label>
                  <input
                    type="text"
                    id="channelId"
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                    placeholder="例: C1234567890"
                    disabled={loading}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="threadTs" className="block text-sm font-medium text-gray-700">
                    スレッドTS
                  </label>
                  <input
                    type="text"
                    id="threadTs"
                    value={threadTs}
                    onChange={(e) => setThreadTs(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                    placeholder="例: 1712345678.987654"
                    disabled={loading}
                    required
                  />
                  <p className="text-xs text-gray-600 mt-1">スレッドのタイムスタンプ（message_ts）を入力してください</p>
                </div>
              </>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? 'スレッド評価実行中...' : 'スレッド評価を実行'}
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

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
            <h3 className="text-lg font-medium text-red-800 mb-2">エラー</h3>
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {loading && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mt-4 p-4">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mr-3"></div>
              <p className="text-gray-700">
                {evaluationMode === 'specific'
                  ? '特定スレッドのSlack評価を実行中です...'
                  : '複数チャンネルでのスレッド評価を実行中です...'}
              </p>
            </div>
          </div>
        )}

        {results && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mt-4 p-4">
            <h2 className="text-base font-semibold leading-6 text-gray-900 mb-4">スレッド評価結果</h2>

            {/* 特定スレッドの結果 */}
            {results.threadTs && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p>
                      <strong>ユーザー名:</strong> {results.username}
                    </p>
                    <p>
                      <strong>チャンネルID:</strong> {results.channelId}
                    </p>
                    <p>
                      <strong>スレッドTS:</strong> {results.threadTs}
                    </p>
                    <p>
                      <strong>メッセージ数:</strong> {results.messageCount}
                    </p>
                  </div>
                </div>

                {/* 最高点予測 */}
                {results.maxScorePredictions && Object.keys(results.maxScorePredictions).length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-lg font-medium mb-3">最高点予測</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {Object.entries(results.maxScorePredictions).map(([criteria, score]) => (
                        <div key={criteria} className="bg-blue-50 p-2 rounded">
                          <p className="text-xs font-medium">{criteria}</p>
                          <p className="text-lg font-bold text-blue-600">{score}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 評価結果 */}
                {results.evaluation && results.evaluation.evaluations && (
                  <div className="mt-6">
                    <h3 className="text-lg font-medium mb-3">評価詳細</h3>
                    <div className="space-y-3">
                      {results.evaluation.evaluations.map((ev: any, index: number) => (
                        <div key={index} className="bg-gray-50 p-3 rounded border">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium">{ev.criteria}</h4>
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                ev.level >= 3
                                  ? 'bg-green-100 text-green-800'
                                  : ev.level >= 2
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-red-100 text-red-800'
                              }`}
                            >
                              レベル {ev.level}
                            </span>
                          </div>
                          <p className="text-gray-700 text-sm mb-2">{ev.reasoning}</p>
                          {ev.evidence && ev.evidence.length > 0 && (
                            <div className="text-xs text-gray-600">
                              <strong>根拠:</strong> {Array.isArray(ev.evidence) ? ev.evidence.join(', ') : ev.evidence}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {results.evaluation.summary && (
                      <div className="mt-4 p-3 bg-blue-50 rounded">
                        <strong className="text-blue-800">総合評価:</strong>
                        <p className="text-blue-700 mt-1">{results.evaluation.summary}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 複数チャンネルの結果 */}
            {results.results && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <p>
                      <strong>ユーザー名:</strong> {results.username}
                    </p>
                    <p>
                      <strong>総チャンネル数:</strong> {results.totalChannels}
                    </p>
                    <p>
                      <strong>成功チャンネル数:</strong> {results.successfulChannels}
                    </p>
                  </div>
                  <div>
                    <p>
                      <strong>収集スレッド数:</strong> {results.totalThreadsCollected}
                    </p>
                    <p>
                      <strong>評価済みスレッド数:</strong> {results.totalThreadsEvaluated}
                    </p>
                  </div>
                  {results.batchInfo && (
                    <div>
                      <p>
                        <strong>バッチサイズ:</strong> {results.batchInfo.batchSize}
                      </p>
                      <p>
                        <strong>並列バッチ数:</strong> {results.batchInfo.concurrentBatches}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-3">チャンネル別結果</h3>
                  <div className="space-y-4">
                    {results.results.map((result: any, index: number) => (
                      <div
                        key={index}
                        className={`p-4 rounded-md border ${
                          result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-medium">チャンネル: {result.channelId}</p>
                            {result.success ? (
                              <p className="text-green-700 text-sm">✅ 評価完了 ({result.threadCount}スレッド)</p>
                            ) : (
                              <p className="text-red-700 text-sm">❌ 評価失敗: {result.error}</p>
                            )}
                          </div>
                        </div>

                        {result.success && result.threads && (
                          <div className="mt-3">
                            <h4 className="text-sm font-medium mb-2">スレッド評価結果:</h4>
                            <div className="space-y-2">
                              {result.threads.map((thread: any, threadIndex: number) => (
                                <div
                                  key={threadIndex}
                                  className={`text-xs p-2 rounded border ${thread.success ? 'bg-white' : 'bg-red-100'}`}
                                >
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <p>
                                        <strong>スレッド {thread.threadTs.slice(-6)}:</strong>{' '}
                                        {thread.success ? (
                                          <span className="text-green-600">
                                            ✅ 評価完了 (全{thread.messageCount}件中{thread.userMessageCount}件発言)
                                          </span>
                                        ) : (
                                          <span className="text-red-600">❌ {thread.error}</span>
                                        )}
                                      </p>
                                      {thread.firstMessage && (
                                        <p className="text-gray-500 mt-1">{thread.firstMessage}</p>
                                      )}
                                    </div>
                                    {thread.evaluation?.maxScorePredictions && (
                                      <div className="flex gap-1">
                                        {Object.entries(thread.evaluation.maxScorePredictions)
                                          .slice(0, 3)
                                          .map(([criteria, score]) => (
                                            <span
                                              key={criteria}
                                              className="bg-blue-100 text-blue-800 px-1 py-0.5 rounded text-xs"
                                            >
                                              {criteria.slice(0, 2)}: {score}
                                            </span>
                                          ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
