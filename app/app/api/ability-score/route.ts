import { type NextRequest, NextResponse } from 'next/server';
import { calculateUserAbility } from '../../../lib/mle-logic';
import { EVALUATION_CRITERIA } from '../../../lib/constants';

interface AbilityScore {
  score: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const { authorUsername, repositorySlug }: { authorUsername: string; repositorySlug: string } = await request.json();

    if (!authorUsername || !repositorySlug) {
      return NextResponse.json({ error: 'Author username and repository name are required' }, { status: 400 });
    }

    const abilityScores: Record<string, AbilityScore> = {};

    for (const criteria of EVALUATION_CRITERIA) {
      try {
        const { ability: score, confidenceInterval } = await calculateUserAbility(
          criteria,
          repositorySlug,
          authorUsername,
          undefined,
          'github',
        );
        abilityScores[criteria] = { score, confidenceInterval };
      } catch (error) {
        console.error(`Error calculating ability for criteria "${criteria}":`, error);
        abilityScores[criteria] = {
          score: 0,
          confidenceInterval: {
            lower: 0,
            upper: 0,
          },
        };
      }
    }

    // 全基準の平均スコアを計算
    const scores = Object.values(abilityScores);
    const averageScore =
      scores.length > 0 ? scores.reduce((sum, scoreObj) => sum + scoreObj.score, 0) / scores.length : 0;

    return NextResponse.json({
      success: true,
      authorUsername,
      repositorySlug,
      abilityScores,
      averageScore: Math.round(averageScore * 1000) / 1000,
      criteriaCount: EVALUATION_CRITERIA.length,
      calculatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Ability Score API Error:', error);

    let errorMessage = 'アビリティスコア計算でエラーが発生しました';

    if (error instanceof Error) {
      errorMessage = `エラー: ${error.message}`;
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
