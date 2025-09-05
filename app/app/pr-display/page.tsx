'use client';

import React, { useState } from 'react';
import Header from '../../components/Header';
import type { PullRequestAnalysisResult } from '../../types';

export default function PRDisplay() {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [author, setAuthor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PullRequestAnalysisResult | null>(null);

  const handleDisplay = async () => {
    if (!owner || !repo || !author) {
      setError('Owner, Repository, and Author are all required');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/display-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ owner, repo, author }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to display data');
      }

      if (data.data.pullRequests) {
        setResult(data.data.pullRequests.data);
      } else {
        setError('No saved PR data found for this repository and author. Please fetch data first.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-sans min-h-screen p-8 pb-20 gap-16 sm:p-20">
      <main className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-4">Display Pull Request Data</h1>
          <p className="text-gray-600">Display saved pull request data from database</p>
        </div>

        {/* Input Form */}
        <div className="mb-8 p-6 bg-white border rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Repository Information</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="owner" className="block text-sm font-medium text-gray-700 mb-2">
                Repository Owner
              </label>
              <input
                type="text"
                id="owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g., facebook"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="repo" className="block text-sm font-medium text-gray-700 mb-2">
                Repository Name
              </label>
              <input
                type="text"
                id="repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="e.g., react"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="author" className="block text-sm font-medium text-gray-700 mb-2">
                PR Author
              </label>
              <input
                type="text"
                id="author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g., gaearon"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>

          <button
            onClick={handleDisplay}
            disabled={loading || !owner || !repo || !author}
            className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            type="button"
          >
            {loading ? 'Loading Saved Data...' : 'Display Saved PR Data'}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">Error: {error}</p>
          </div>
        )}

        {/* Results Display */}
        {result && (
          <div className="mb-8 p-6 bg-white border rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Saved Pull Request Data</h2>
            <p className="mb-4">
              Total PRs by <strong>{author}</strong> in{' '}
              <strong>
                {owner}/{repo}
              </strong>
              : <strong>{result.total_count}</strong>
            </p>
            <p className="mb-4 text-sm text-gray-600">
              Displaying saved data for {result.pull_requests.length} pull requests
            </p>

            <div className="bg-gray-50 p-4 rounded overflow-auto max-h-96">
              <pre className="text-sm text-gray-800">
                {JSON.stringify(
                  {
                    total_count: result.total_count,
                    pull_requests: result.pull_requests.slice(0, 3), // Show first 3 for display
                  },
                  null,
                  2,
                )}
              </pre>
            </div>

            <p className="mt-2 text-sm text-gray-600">Showing first 3 pull requests from saved data.</p>
          </div>
        )}

        <div className="mt-8 flex gap-4">
          <a href="/" className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors">
            ← Home
          </a>
          <a
            href="/github-data-fetch"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Fetch Fresh GitHub Data
          </a>
          <a
            href="/issue-display"
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
          >
            Display Issues
          </a>
          <a
            href="/contributor-analyze"
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
          >
            Go to Evaluation
          </a>
        </div>
      </main>
    </div>
  );
}
