import { type NextRequest, NextResponse } from 'next/server';
import { predictMaxScoresForUserBasicInfo } from '../../../lib/max-score-prediction';

// リポジトリ + ユーザー単位の満点予測エンドポイント（従来の一括版を置き換え）
export async function POST(request: NextRequest) {
  try {
    const { repositoryName, user } = await request.json();
    if (!repositoryName || !user) {
      return NextResponse.json({ error: 'repositoryName と user は必須です' }, { status: 400 });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
    }
    const results = await predictMaxScoresForUserBasicInfo(apiKey, repositoryName, user);

    // 予測結果は既に関数内で保存済み
    const totalPredictions = results.reduce((sum, item) => sum + item.predictions.length, 0);

    return NextResponse.json({
      success: true,
      repositoryName,
      user,
      itemCount: results.length,
      totalPredictions,
      message: `${results.length}件のアイテムから${totalPredictions}件の満点予測を完了し、データベースに保存しました`,
      results,
    });
  } catch (error) {
    console.error('User max score prediction error:', error);
    return NextResponse.json(
      { error: 'ユーザー満点予測エラー: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}
