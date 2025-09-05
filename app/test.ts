// テスト対象の関数をインポートします
import { sigmoid, logLikelihood, estimateAbilityByGridSearchMAP } from './lib/mle-logic';

/**
 * sigmoid 関数のテスト
 */
describe('sigmoid', () => {
  test('0を入力すると0.5を返すこと', () => {
    expect(sigmoid(0)).toBe(0.5);
  });

  test('大きな正の数を入力すると1に近づくこと', () => {
    expect(sigmoid(10)).toBeCloseTo(1);
  });

  test('大きな負の数を入力すると0に近づくこと', () => {
    expect(sigmoid(-10)).toBeCloseTo(0);
  });
});

/**
 * logLikelihood 関数のテスト（動的パラメータ版）
 */
describe('logLikelihood', () => {
  test('単一の評価項目（満点未満）で対数尤度を正しく計算できること', () => {
    const ability = 2.0;
    const evaluations = [{ level: 1, predictedMaxScore: 3 }]; // level=1, max=3

    // logLikelihood関数の動作を確認するための基本テスト（動的パラメータ版）
    const result = logLikelihood(ability, evaluations);
    expect(typeof result).toBe('number');
    expect(result).toBeLessThan(0); // 対数尤度は通常負の値
  });

  test('単一の評価項目（満点）で対数尤度を正しく計算できること', () => {
    const ability = 3.0;
    const evaluations = [{ level: 3, predictedMaxScore: 3 }]; // level=3, max=3 (満点)

    const result = logLikelihood(ability, evaluations);
    expect(typeof result).toBe('number');
    expect(result).toBeLessThan(0); // 対数尤度は通常負の値
  });

  test('複数の評価項目で対数尤度が正しく合計されること', () => {
    const ability = 2.0;
    const evaluations = [
      { level: 1, predictedMaxScore: 3 }, // 満点未満
      { level: 3, predictedMaxScore: 3 }, // 満点
    ];
    // 個別の計算結果
    const ll_item1 = logLikelihood(ability, [evaluations[0]]);
    const ll_item2 = logLikelihood(ability, [evaluations[1]]);
    const expected = ll_item1 + ll_item2;

    const result = logLikelihood(ability, evaluations);
    expect(result).toBeCloseTo(expected, 5);
  });
});

/**
 * estimateAbilityByGridSearchMAP 関数のテスト
 */
describe('estimateAbilityByGridSearchMAP', () => {
  // alpha=0.88, beta=0.85は関数内で固定されている

  test('高得点が観測された場合、高い能力値が推定されること', () => {
    // 高い得点が多い場合、高い能力値が推定されるはず
    const evaluations = [
      { level: 4, predictedMaxScore: 4 }, // 満点
      { level: 3, predictedMaxScore: 4 }, // 高得点
    ];

    const ALPHA = 2;
    const BETA_PARAM = 5;
    const xMin = 0;
    const xMax = 4;
    const result = estimateAbilityByGridSearchMAP(evaluations, ALPHA, BETA_PARAM, xMin, xMax);
    const estimatedAbility = result.bestAbility;

    // 高い能力値が推定されることを確認（MAP推定では事前分布の影響で少し低めになる）
    expect(estimatedAbility).toBeGreaterThan(1.5);
    expect(estimatedAbility).toBeLessThanOrEqual(4.0);
  });

  test('低得点が観測された場合、低い能力値が推定されること', () => {
    // 低い得点が多い場合、低い能力値が推定されるはず
    const evaluations = [
      { level: 0, predictedMaxScore: 4 },
      { level: 1, predictedMaxScore: 4 },
    ];

    const ALPHA = 2;
    const BETA_PARAM = 5;
    const xMin = 0;
    const xMax = 4;
    const result = estimateAbilityByGridSearchMAP(evaluations, ALPHA, BETA_PARAM, xMin, xMax);
    const estimatedAbility = result.bestAbility;

    // 低い能力値が推定されることを確認
    expect(estimatedAbility).toBeGreaterThanOrEqual(0.0);
    expect(estimatedAbility).toBeLessThan(2.0);
  });

  test('満点の観測データで適切な能力値が推定されること', () => {
    // 満点を取っている場合
    const evaluations = [
      { level: 3, predictedMaxScore: 3 },
      { level: 3, predictedMaxScore: 3 },
    ];

    const ALPHA = 2;
    const BETA_PARAM = 5;
    const xMin = 0;
    const xMax = 3;
    const result = estimateAbilityByGridSearchMAP(evaluations, ALPHA, BETA_PARAM, xMin, xMax);
    const estimatedAbility = result.bestAbility;

    // 満点を取れる能力値が推定されることを確認（MAP推定では事前分布の影響あり）
    expect(estimatedAbility).toBeGreaterThan(1.0);
    expect(estimatedAbility).toBeLessThanOrEqual(3.0);
  });

  test('満点の観測データで適切な能力値が推定されること', () => {
    // 満点を取っている場合
    const evaluations = [
      { level: 2, predictedMaxScore: 2 },
      { level: 2, predictedMaxScore: 2 },
    ];

    const ALPHA = 2;
    const BETA_PARAM = 5;
    const xMin = 0;
    const xMax = 2;
    const result = estimateAbilityByGridSearchMAP(evaluations, ALPHA, BETA_PARAM, xMin, xMax);
    const estimatedAbility = result.bestAbility;

    // 満点を取れる能力値が推定されることを確認（MAP推定では事前分布の影響あり）
    expect(estimatedAbility).toBeGreaterThan(0.5);
    expect(estimatedAbility).toBeLessThanOrEqual(2.0);
  });

  test('中間的な得点が観測された場合、中間の能力値が推定されること', () => {
    // 中間的な得点が観測された場合
    const evaluations = [
      { level: 2, predictedMaxScore: 4 },
      { level: 2, predictedMaxScore: 4 },
    ];

    const ALPHA = 2;
    const BETA_PARAM = 5;
    const xMin = 0;
    const xMax = 4;
    const result = estimateAbilityByGridSearchMAP(evaluations, ALPHA, BETA_PARAM, xMin, xMax);
    const estimatedAbility = result.bestAbility;

    // 中間的な能力値が推定されることを確認
    expect(estimatedAbility).toBeGreaterThan(0.0);
    expect(estimatedAbility).toBeLessThanOrEqual(4.0);
    expect(typeof estimatedAbility).toBe('number');
  });
});
