import type { LearningCurvePoint } from "../types";

/**
 * Complexity tiers and the learning curves they imply.
 *
 * A harder garment costs more minutes per piece at steady state — but that is
 * already captured by the style's SMV. What complexity uniquely determines is
 * how long a line takes to *reach* steady state. So complexity drives the ramp
 * here, and no longer scales SMV (which double-counted it).
 *
 * The curve is exponential rather than a hand-authored table because two
 * parameters can be fitted from production history, whereas seven typed-in
 * points can only be guessed at and go stale.
 */

export type ComplexityTier = "T1" | "T2" | "T3" | "T4";

export interface LearningCurveParams {
  /** Efficiency on the first day of a new style. */
  start: number;
  /** Steady-state efficiency the line converges on. */
  target: number;
  /** Days constant — larger means a slower ramp. */
  tau: number;
}

interface TierDefinition {
  label: string;
  /** Upper bound (exclusive) of the complexity range for this tier. */
  maxComplexity: number;
  curve: LearningCurveParams;
}

/**
 * Parameters are tuned to track the previously hand-authored seed curves, so
 * enabling complexity-driven curves does not swing existing plans wildly.
 */
export const COMPLEXITY_TIERS: Record<ComplexityTier, TierDefinition> = {
  T1: {
    label: "Basic",
    maxComplexity: 1.0,
    curve: { start: 0.65, target: 1.0, tau: 1.6 },
  },
  T2: {
    label: "Moderate",
    maxComplexity: 1.35,
    curve: { start: 0.58, target: 1.0, tau: 2.0 },
  },
  T3: {
    label: "Complex",
    maxComplexity: 1.7,
    curve: { start: 0.55, target: 1.0, tau: 2.4 },
  },
  T4: {
    label: "Advanced",
    maxComplexity: Number.POSITIVE_INFINITY,
    curve: { start: 0.5, target: 1.0, tau: 2.9 },
  },
};

const TIER_ORDER: ComplexityTier[] = ["T1", "T2", "T3", "T4"];

export function tierForComplexity(complexity: number): ComplexityTier {
  for (const tier of TIER_ORDER) {
    if (complexity < COMPLEXITY_TIERS[tier].maxComplexity) return tier;
  }
  return "T4";
}

export function curveParamsForComplexity(
  complexity: number
): LearningCurveParams {
  return COMPLEXITY_TIERS[tierForComplexity(complexity)].curve;
}

/**
 * Efficiency on a given day of a style run. Day 1 returns `start`; the curve
 * approaches `target` asymptotically.
 */
export function efficiencyAtDay(
  params: LearningCurveParams,
  day: number
): number {
  if (day <= 1) return clamp(params.start);
  const ramp = 1 - Math.exp(-(day - 1) / params.tau);
  return clamp(params.start + (params.target - params.start) * ramp);
}

export function efficiencyForComplexity(
  complexity: number,
  day: number
): number {
  return efficiencyAtDay(curveParamsForComplexity(complexity), day);
}

/**
 * Materialise the parametric curve as discrete points, for callers that want to
 * display or persist it in the same shape as an authored curve.
 */
export function curveToPoints(
  params: LearningCurveParams,
  days = 7
): LearningCurvePoint[] {
  return Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    efficiency: Number(efficiencyAtDay(params, i + 1).toFixed(4)),
  }));
}

/**
 * Days until a line on this style crosses a given efficiency threshold.
 * Returns Infinity when the target sits at or above the curve's ceiling.
 */
export function daysToReachEfficiency(
  params: LearningCurveParams,
  threshold: number
): number {
  if (threshold <= params.start) return 1;
  if (threshold >= params.target) return Number.POSITIVE_INFINITY;
  const fraction =
    (threshold - params.start) / (params.target - params.start);
  return 1 + -params.tau * Math.log(1 - fraction);
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
