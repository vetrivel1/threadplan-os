import type { LearningCurvePoint, PackingType, StageCode } from "../types";
import { PACKING_DRAG } from "../types";
import { efficiencyForComplexity } from "./complexity";

const DEFAULT_LEARNING_CURVE: LearningCurvePoint[] = [
  { day: 1, efficiency: 0.55 },
  { day: 2, efficiency: 0.68 },
  { day: 3, efficiency: 0.78 },
  { day: 4, efficiency: 0.86 },
  { day: 5, efficiency: 0.92 },
  { day: 6, efficiency: 0.96 },
  { day: 7, efficiency: 1.0 },
];

/**
 * How quickly a line forgets a style it has not run recently. Retained learning
 * decays as exp(-idleDays / RETENTION_DECAY_DAYS).
 */
export const RETENTION_DECAY_DAYS = 14;

export interface LearningLookup {
  curves: Record<string, LearningCurvePoint[]>;
  styleId: string;
  dayOnStyle: number;
  /** Supplied when complexity-driven curves are enabled. */
  complexity?: number;
}

/** How a style×line curve is keyed in the `curves` map. */
export function lineCurveKey(styleId: string, lineId: string): string {
  return `${styleId}:${lineId}`;
}

/**
 * Efficiency for a given day of a style run.
 *
 * Checked most-specific first: an authored style×line curve, since a line an
 * operator already knows this style on climbs differently than a line seeing
 * it cold; then a style-wide curve; then, when a complexity is supplied, the
 * tier's parametric curve; failing all three, a neutral default table.
 */
export function getLearningEfficiency(
  curves: Record<string, LearningCurvePoint[]>,
  styleId: string,
  dayOnStyle: number,
  complexity?: number,
  lineId?: string
): number {
  const authored =
    (lineId && curves[lineCurveKey(styleId, lineId)]) || curves[styleId];

  if (!authored) {
    if (complexity != null) {
      return efficiencyForComplexity(complexity, Math.max(1, dayOnStyle));
    }
    return lookupCurve(DEFAULT_LEARNING_CURVE, dayOnStyle);
  }

  return lookupCurve(authored, dayOnStyle);
}

function lookupCurve(
  curve: LearningCurvePoint[],
  dayOnStyle: number
): number {
  const sorted = [...curve].sort((a, b) => a.day - b.day);
  if (dayOnStyle <= 0) return sorted[0]?.efficiency ?? 0.55;
  const match = sorted.filter((p) => p.day <= dayOnStyle).pop();
  if (match) return match.efficiency;
  return sorted[sorted.length - 1]?.efficiency ?? 1.0;
}

/**
 * Learning retained on a line for a style it has run before, expressed as an
 * equivalent number of days already spent on the curve.
 */
export function retainedDaysOnStyle(
  priorDays: number,
  idleDays: number
): number {
  if (priorDays <= 0) return 0;
  const retained = priorDays * Math.exp(-Math.max(0, idleDays) / RETENTION_DECAY_DAYS);
  return Math.max(0, Math.floor(retained));
}

/**
 * Line-minutes needed to push a quantity through one stage on one line.
 *
 * This is the planning-grade inverse of `dailyLineCapacity`: it ignores the
 * learning ramp and answers "roughly how long will this occupy the line", which
 * is what load balancing and lead-time estimates need.
 */
export function estimateLineMinutes(
  quantity: number,
  smv: number,
  operators: number,
  efficiency: number,
  packingType: PackingType,
  stage: StageCode
): number {
  if (quantity <= 0 || smv <= 0) return 0;
  const packingMultiplier =
    stage === "packing" ? PACKING_DRAG[packingType] : 1.0;
  const operatorMinutes = quantity * smv * packingMultiplier;
  const denominator = Math.max(1, operators) * Math.max(0.01, efficiency);
  return operatorMinutes / denominator;
}

/**
 * Legacy SMV scaling by complexity.
 *
 * Superseded by complexity-driven learning curves, which model the same effect
 * without double-counting what per-style SMV already encodes. Kept so
 * LEGACY_PHYSICS can reproduce pre-MCOE output exactly.
 */
export function complexityFactor(complexity: number): number {
  return 1 + (complexity - 1) * 0.08;
}

export function dailyLineCapacity(
  operators: number,
  shiftMinutes: number,
  smv: number,
  efficiency: number,
  packingType: PackingType,
  stage: StageCode
): number {
  if (smv <= 0) return 0;
  const packingMultiplier =
    stage === "packing" ? PACKING_DRAG[packingType] : 1.0;
  const effectiveMinutes = Math.max(0, shiftMinutes) * efficiency;
  const pieces = Math.floor((operators * effectiveMinutes) / (smv * packingMultiplier));
  return Math.max(0, pieces);
}
