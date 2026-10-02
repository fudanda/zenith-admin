/**
 * 评分卡求值引擎（纯函数）：
 * 各变量经安全表达式取值 → 命中首个分段得分 × 权重，求和加基础分得总分，
 * 再按等级映射（minScore 降序取首个满足档位）输出等级与建议决策。
 */
import type {
  RuleScorecardBand,
  RuleScorecardEvaluateResult,
  RuleScorecardGrade,
  RuleScorecardVariable,
  RuleScorecardVariableTrace,
} from '@arcbase/shared/rules';
import { evaluateExpression } from './workflow-expression';

export interface ScorecardLike {
  baseScore: number;
  variables: RuleScorecardVariable[];
  grades: RuleScorecardGrade[];
}

/** 浮点得分保留 4 位小数，避免权重乘法的二进制误差外溢 */
function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function describeScorecardBand(band: RuleScorecardBand): string {
  if (band.label) return band.label;
  switch (band.op) {
    case 'default':
      return '兜底';
    case 'eq':
      return `= ${band.value ?? ''}`;
    case 'in':
      return `in [${(band.values ?? []).join(', ')}]`;
    case 'range': {
      const lo = band.min == null ? '-∞' : String(band.min);
      const hi = band.max == null ? '+∞' : String(band.max);
      return `[${lo}, ${hi})`;
    }
  }
}

function bandMatches(band: RuleScorecardBand, raw: unknown): boolean {
  switch (band.op) {
    case 'default':
      return true;
    case 'eq':
      return raw != null && String(raw) === String(band.value ?? '');
    case 'in':
      return raw != null && (band.values ?? []).some((v) => String(raw) === v);
    case 'range': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (raw == null || raw === '' || !Number.isFinite(n)) return false;
      if (band.min != null && n < band.min) return false;
      if (band.max != null && n >= band.max) return false;
      return true;
    }
  }
}

export function evaluateScorecard(card: ScorecardLike, scope: Record<string, unknown>): RuleScorecardEvaluateResult {
  const baseScore = card.baseScore ?? 0;
  let total = baseScore;
  const traces: RuleScorecardVariableTrace[] = [];

  for (const variable of card.variables ?? []) {
    let raw: unknown;
    try {
      raw = evaluateExpression(variable.expr, scope);
    } catch {
      raw = null;
    }
    let score = variable.missingScore ?? 0;
    let matchedBand: string | null = null;
    let missed = true;
    for (const band of variable.bands ?? []) {
      if (bandMatches(band, raw)) {
        score = band.score;
        matchedBand = describeScorecardBand(band);
        missed = false;
        break;
      }
    }
    const weight = variable.weight ?? 1;
    const weighted = round(score * weight);
    total += weighted;
    traces.push({ key: variable.key, label: variable.label, raw, matchedBand, score, weight, weighted, missed });
  }

  const totalScore = round(total);
  const grade = [...(card.grades ?? [])]
    .sort((a, b) => b.minScore - a.minScore)
    .find((g) => totalScore >= g.minScore) ?? null;

  return {
    totalScore,
    baseScore,
    grade: grade?.grade ?? null,
    decision: grade?.decision ?? null,
    variables: traces,
  };
}
