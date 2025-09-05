'use client';

import React, { useState } from 'react';

export default function SlackFetchPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string>('');

  const fetchSlackMessages = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!channelId.trim()) {
        setError('channelId を入力してください');
        setLoading(false);
        return;
      }
      const response = await fetch('/api/slack-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: channelId.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch Slack messages');
      setMessages(data.messages || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Fetch Slack Messages</h1>
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex items-center gap-4 flex-wrap">
            <input
              type="text"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              placeholder="チャンネルID"
              className="px-3 py-2 border rounded w-64 text-sm focus:outline-none focus:ring focus:border-blue-400"
            />
            <button
              onClick={fetchSlackMessages}
              disabled={loading || !channelId.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Loading...' : '全履歴取得'}
            </button>
          </div>
          {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}
          {!error && !loading && messages.length > 0 && (
            <div className="mt-6">
              <h2 className="font-semibold mb-2 text-gray-700">Messages ({messages.length})</h2>
              <ul className="space-y-2 max-h-96 overflow-auto text-sm">
                {messages.slice(0, 50).map((m) => (
                  <li key={m.ts} className="p-2 border rounded bg-gray-50">
                    <div className="text-gray-800 whitespace-pre-wrap break-words">{m.text}</div>
                    <div className="text-xs text-gray-400 mt-1 flex gap-2">
                      <span>ts:{m.ts}</span>
                      {m.user && <span>user:{m.user}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
