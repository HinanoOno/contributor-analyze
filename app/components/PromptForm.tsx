interface PromptFormProps {
  prompt: string;
  loading: boolean;
  onPromptChange: (prompt: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClear: () => void;
}

export default function PromptForm({ prompt, loading, onPromptChange, onSubmit, onClear }: PromptFormProps) {
  return (
    <form onSubmit={onSubmit} className="mb-8">
      <div className="mb-4">
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="プロンプトを入力してください..."
          className="w-full p-4 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 min-h-[120px] resize-y"
          disabled={loading}
        />
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="flex-1 sm:flex-initial px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-400 text-white font-medium rounded-lg transition-all duration-200 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:transform-none"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              処理中...
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                role="img"
                aria-label="Send message"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
              送信
            </div>
          )}
        </button>
        {prompt && (
          <button
            type="button"
            onClick={onClear}
            className="px-4 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
          >
            クリア
          </button>
        )}
      </div>
    </form>
  );
}
