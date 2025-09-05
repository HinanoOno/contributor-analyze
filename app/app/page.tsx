'use client';

import React from 'react';
import Header from '../components/Header';
import PromptForm from '../components/PromptForm';
import ResponseDisplay from '../components/ResponseDisplay';
import { useGeminiAPI } from '../hooks/useGeminiAPI';

export default function Home() {
  const { prompt, response, loading, setPrompt, handleSubmit, handleClear } = useGeminiAPI();

  return (
    <div className="font-sans min-h-screen p-8 pb-20 gap-16 sm:p-20">
      <main className="max-w-4xl mx-auto">
        <Header />

        <PromptForm
          prompt={prompt}
          loading={loading}
          onPromptChange={setPrompt}
          onSubmit={handleSubmit}
          onClear={handleClear}
        />
        <ResponseDisplay response={response} loading={loading} />
      </main>
    </div>
  );
}
