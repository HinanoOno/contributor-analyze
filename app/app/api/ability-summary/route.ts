import { type NextRequest, NextResponse } from 'next/server';

import {
  getAllEvaluationCriteria,
  processSingleCriteriaWithCache,
  generateSingleCriteriaSummaryInput,
} from '../../../lib/ability-summary-prompt';
import { BatchProcessor, retryWithBackoff } from '../../../lib/batch-processor';
import { saveAbilitySummary, getAbilitySummariesByAuthor } from '../../../lib/github-db';
import { calculateUserAbility } from '../../../lib/mle-logic';

export async function POST(request: NextRequest) {
  try {
    const { repositorySlug, username } = await request.json();

    if (!repositorySlug || !username) {
      return NextResponse.json({ error: 'repositorySlugとusernameが必要です' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
    }

    console.log(`🚀 Starting ability summary generation for ${username} in ${repositorySlug}`);

    // 1. 全評価基準 + 既存キャッシュ取得
    const allCriteria: string[] = getAllEvaluationCriteria();
    const cachedRows = await getAbilitySummariesByAuthor(repositorySlug, username);
    const cachedMap = new Map<string, any>(
      cachedRows.map((r) => [
        r.criteria_name,
        { criteria_name: r.criteria_name, evaluation_level: r.ability_score, summary: r.summary_text, cached: true },
      ]),
    );
    const missingCriteria = allCriteria.filter((c) => !cachedMap.has(c));

    if (missingCriteria.length === 0) {
      // 全てキャッシュ済み
      return NextResponse.json({
        success: true,
        repositorySlug,
        username,
        summary: allCriteria.map((c) => cachedMap.get(c)).filter(Boolean),
        totalCriteria: allCriteria.length,
        processedCriteria: 0,
        fromCache: true,
      });
    }

    // 2. 各基準を処理する関数
    const processCriteria = async (criteriaNameInput: any) => {
      const criteriaName = String(criteriaNameInput);
      console.log(`🔄 Generating input data for ${criteriaName}...`);
      const inputData = await generateSingleCriteriaSummaryInput(repositorySlug, username, criteriaName);
      if (!inputData) {
        console.log(`⏭️ Skipping ${criteriaName} - no evaluation data`);
        return null;
      }

      console.log(`🔄 Calling cached API for ${criteriaName} (input length: ${inputData.length})...`);
      const result = await processSingleCriteriaWithCache(repositorySlug, username, criteriaName, apiKey, inputData);

      if (!result) {
        console.error(`❌ No result for ${criteriaName}`);
        return null;
      }

      const response = result.response;
      const text = response.text();

      if (!text) {
        console.error(`❌ No response text for ${criteriaName}`);
        return null;
      }

      console.log(`🔄 Parsing response for ${criteriaName} (response length: ${text.length})...`);

      // JSONを解析
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const raw = jsonMatch ? jsonMatch[0] : text;
        const parsed = JSON.parse(raw) || {};
        // ability を必ず MLE で再計算し正とする
        let abilityScore = 0;
        try {
          const ability = await calculateUserAbility(criteriaName, repositorySlug, username, undefined, 'github');
          abilityScore = ability.ability;
          await saveAbilitySummary({
            repositoryName: repositorySlug,
            author: username,
            criteriaName,
            abilityScore,
            summaryText: parsed.summary || parsed.summary_text || '',
          });
        } catch (e) {
          console.error('Failed to save ability summary:', e);
        }
        console.log(`✅ ${criteriaName} completed and saved`);
        return {
          criteria_name: criteriaName,
          evaluation_level: abilityScore,
          summary: parsed.summary || parsed.summary_text || '',
          cached: false,
        };
      } catch (parseError) {
        console.error(`❌ Failed to parse JSON for ${criteriaName}:`, parseError);
        console.log(`Raw response for ${criteriaName}:`, text.substring(0, 300));
        return null;
      }
    };

    // 3. バッチ処理で全基準を処理
    const batchProcessor = new BatchProcessor({
      batchSize: 2,
      batchDelayMs: 3000,
      itemTimeoutMs: 3 * 60 * 1000, // 3分
      batchTimeoutMs: 5 * 60 * 1000, // 5分
      concurrentBatches: 2, // 複数バッチ並行実行
    });

    const successfulResults = await batchProcessor.processBatches(
      missingCriteria,
      processCriteria,
      (criteriaName) => String(criteriaName),
      'criteria',
    );
    console.log(
      `✅ Ability summary completed: newly processed ${successfulResults.length}, cached ${cachedMap.size}, total ${allCriteria.length}`,
    );

    if (successfulResults.length === 0 && cachedMap.size === 0) {
      return NextResponse.json(
        {
          error: '指定されたユーザーの評価データが見つかりません',
          details: 'いずれの評価基準についても、MLE計算に必要な評価データが存在しません',
        },
        { status: 404 },
      );
    }

    // 最終まとめ: 元の順序で並べる
    const newMap = new Map<string, any>();
    for (const r of successfulResults as any[]) {
      if (r && (r as any).criteria_name) newMap.set((r as any).criteria_name, r);
    }
    const finalList = allCriteria.map((c) => newMap.get(c) || cachedMap.get(c)).filter(Boolean);

    return NextResponse.json({
      success: true,
      repositorySlug,
      username,
      summary: finalList,
      totalCriteria: allCriteria.length,
      processedCriteria: successfulResults.length,
      cachedCount: cachedMap.size,
    });
  } catch (error: unknown) {
    console.error('Ability summary API Error:', error);
    const err = error as Error;
    let errorMessage = '能力サマリー生成でエラーが発生しました';
    if (err instanceof Error) {
      errorMessage = `能力サマリー生成エラー: ${err.message}`;
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
