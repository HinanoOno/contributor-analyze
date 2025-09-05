import Image from 'next/image';

export default function Header() {
  return (
    <div className="flex flex-col items-center mb-12">
      <Image className="dark:invert mb-8" src="/next.svg" alt="Next.js logo" width={180} height={38} priority />
      <h1 className="text-2xl font-bold mb-4">Google AI Gemini Chat</h1>
      <p className="text-gray-600 dark:text-gray-400 text-center">プロンプトを入力してGemini APIからの回答を取得</p>
    </div>
  );
}
