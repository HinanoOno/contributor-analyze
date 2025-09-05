import {
  getUserEvaluationsByCriteria,
  getSlackThreadEvaluationsByUserAndCriteria,
  getSlackUserInfo,
} from '../lib/github-db';
import { jStat } from 'jstat';

export async function calculateUserAbility(
  criteriaName: string,
  repositorySlug?: string,
  authorUsername?: string,
  username?: string,
  source?: 'github' | 'slack-thread',
  channelIds?: string[],
): Promise<{ ability: number; confidenceInterval: { lower: number; upper: number } }> {
  let evaluations;
  if (source === 'github') {
    if (!repositorySlug || !authorUsername) {
      throw new Error('repositorySlug and authorUsername must be provided for github source');
    }
    evaluations = await getUserEvaluationsByCriteria(repositorySlug, authorUsername, criteriaName);
  } else if (source === 'slack-thread') {
    if (!username) {
      throw new Error('username must be provided for slack-thread source');
    }
    const userInfo = await getSlackUserInfo(username);
    if (!userInfo) {
      throw new Error(`Slack user not found: ${username}`);
    }
    evaluations = await getSlackThreadEvaluationsByUserAndCriteria(userInfo.userId, criteriaName, channelIds);
  } else {
    throw new Error(`Unknown source: ${source}`);
  }

  if (evaluations.length === 0) {
    return { ability: 0, confidenceInterval: { lower: 0, upper: 0 } };
  }

  // 評価できる結果のみに絞る
  const validEvaluations = evaluations.filter((evaluation) => evaluation.evaluable);

  if (validEvaluations.length === 0) {
    return { ability: 0, confidenceInterval: { lower: 0, upper: 0 } };
  }

  // MLE推定用のデータ形式に変換
  let mleData: { level: number; predictedMaxScore: number }[];
  if (source === 'slack-thread') {
    // Slackスレッド評価: 予測最高点を使用
    mleData = validEvaluations.map((evaluation) => ({
      level: evaluation.evaluationLevel,
      predictedMaxScore: evaluation.predictedMaxScore ?? 4,
    }));
  } else {
    // GitHub評価
    mleData = validEvaluations.map((evaluation) => ({
      level: evaluation.level!,
      predictedMaxScore: evaluation.predictedMaxScore ?? 2,
    }));
  }

  // MAP推定による能力値計算
  const ALPHA = 2;
  const BETA_PARAM = 5;
  const xMin = 0;
  const xMax = 4;

  const mapResult = estimateAbilityByGridSearchMAP(mleData, ALPHA, BETA_PARAM, xMin, xMax);
  const ability = mapResult.bestAbility;

  // ベイズ信頼区間の計算
  const confidenceInterval = calculateBayesianConfidenceInterval(ability, mleData, ALPHA, BETA_PARAM, xMin, xMax);

  return { ability, confidenceInterval };
}

// シグモイド関数
export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

// 対数尤度関数
export function logLikelihood(ability: number, evaluations: { level: number; predictedMaxScore: number }[]): number {
  let logLikelihood = 0;

  for (const evalItem of evaluations) {
    const k = evalItem.level;
    const x = evalItem.predictedMaxScore; // x = 満点
    const n = x;

    // TODO：仮置き
    const item_alpha = 1.0;
    const item_beta = 0.0;

    const prob_y = sigmoid(item_alpha * (ability - k) + item_beta);

    let likelihood: number;

    if (k === n) {
      // 満点を取った場合
      likelihood = prob_y;
    } else {
      // 満点未満の場合
      const prob_y1 = sigmoid(item_alpha * (ability - (k + 1)) + item_beta);
      likelihood = prob_y - prob_y1;
    }

    const epsilon = 1e-10;
    logLikelihood += Math.log(Math.max(likelihood, epsilon));
  }

  return logLikelihood;
}

export function logPrior(ability: number, ALPHA: number, BETA_PARAM: number, xMin: number, xMax: number): number {
  const x = ability;
  if (!(xMin <= x && x <= xMax)) {
    return -Infinity;
  }

  if (x === xMin || x === xMax) {
    return -Infinity;
  }

  const logPdf =
    Math.log(6) +
    Math.log(x - xMin) -
    Math.log(xMax - xMin) +
    (BETA_PARAM - 1) * (Math.log(xMax - x) - Math.log(xMax - xMin));

  return logPdf;
}

export function logPosterior(
  ability: number,
  evaluations: { level: number; predictedMaxScore: number }[],
  ALPHA: number,
  BETA_PARAM: number,
  xMin: number,
  xMax: number,
): number {
  return logLikelihood(ability, evaluations) + logPrior(ability, ALPHA, BETA_PARAM, xMin, xMax);
}

export function estimateAbilityByGridSearchMAP(
  evaluations: { level: number; predictedMaxScore: number }[],
  ALPHA: number,
  BETA_PARAM: number,
  xMin: number,
  xMax: number,
  gridPoints: number = 500,
): {
  bestAbility: number;
  abilities: number[];
  logPriors: number[];
  logLikelihoods: number[];
  logPosteriors: number[];
} {
  if (evaluations.length === 0) {
    const mode = xMin + ((xMax - xMin) * (ALPHA - 1)) / (ALPHA + BETA_PARAM - 2);
    return {
      bestAbility: mode,
      abilities: [],
      logPriors: [],
      logLikelihoods: [],
      logPosteriors: [],
    };
  }

  const abilities: number[] = [];
  for (let i = 0; i <= gridPoints; i++) {
    abilities.push(xMin + (i / gridPoints) * (xMax - xMin));
  }

  const logPriors = abilities.map((ab) => logPrior(ab, ALPHA, BETA_PARAM, xMin, xMax));
  const logLikelihoods = abilities.map((ab) => logLikelihood(ab, evaluations));
  const logPosteriors = logLikelihoods.map((ll, i) => ll + logPriors[i]);

  const validIndices = logPosteriors.map((lp, i) => ({ value: lp, index: i })).filter((item) => isFinite(item.value));

  if (validIndices.length === 0) {
    return {
      bestAbility: xMin,
      abilities,
      logPriors,
      logLikelihoods,
      logPosteriors,
    };
  }

  const maxItem = validIndices.reduce((max, current) => (current.value > max.value ? current : max));
  const bestAbility = abilities[maxItem.index];

  return {
    bestAbility,
    abilities,
    logPriors,
    logLikelihoods,
    logPosteriors,
  };
}

export function calculateBayesianConfidenceInterval(
  estimatedAbility: number,
  evaluations: { level: number; predictedMaxScore: number }[],
  ALPHA: number,
  BETA_PARAM: number,
  xMin: number,
  xMax: number,
): { lower: number; upper: number } {
  if (evaluations.length === 0) {
    return { lower: xMin, upper: xMax };
  }

  const h = 0.0001;

  const lpAtPeak = logPosterior(estimatedAbility, evaluations, ALPHA, BETA_PARAM, xMin, xMax);
  const lpPlusH = logPosterior(estimatedAbility + h, evaluations, ALPHA, BETA_PARAM, xMin, xMax);
  const lpMinusH = logPosterior(estimatedAbility - h, evaluations, ALPHA, BETA_PARAM, xMin, xMax);

  const secondDerivative = (lpPlusH - 2 * lpAtPeak + lpMinusH) / (h * h);

  const information = -secondDerivative;

  if (information <= 0 || !isFinite(information)) {
    return { lower: xMin, upper: xMax };
  }

  const standardError = 1.0 / Math.sqrt(information);

  const zScore = 1.96;
  const marginOfError = zScore * standardError;

  const lower = estimatedAbility - marginOfError;
  const upper = estimatedAbility + marginOfError;

  return {
    lower: Math.max(xMin, lower),
    upper: Math.min(xMax, upper),
  };
}
