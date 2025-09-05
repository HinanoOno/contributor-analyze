import { useState } from 'react';

export function useGeminiAPI() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setResponse('');

    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();

      if (res.ok) {
        setResponse(data.response);
      } else {
        setResponse(`エラー: ${data.error}`);
      }
    } catch (error) {
      setResponse('リクエストでエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setPrompt('');
  };

  return {
    prompt,
    response,
    loading,
    setPrompt,
    handleSubmit,
    handleClear,
  };
}
