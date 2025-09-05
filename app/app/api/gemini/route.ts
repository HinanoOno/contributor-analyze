import { GoogleGenerativeAI } from '@google/generative-ai';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: 'プロンプトが必要です' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const result = await model.generateContent(prompt);

    const response = result.response;
    const text = response.candidates?.[0]?.content.parts[0]?.text;

    if (!text) {
      return NextResponse.json({ error: 'Geminiから回答を取得できませんでした' }, { status: 500 });
    }

    return NextResponse.json({ response: text });
  } catch (error) {
    console.error('Gemini API Error:', error);

    let errorMessage = 'APIリクエストでエラーが発生しました';

    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        errorMessage = 'APIキーが無効または権限がありません';
      } else if (error.message.includes('quota')) {
        errorMessage = 'APIクォータを超過しました';
      } else if (error.message.includes('billing')) {
        errorMessage = '課金が有効になっていません';
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
