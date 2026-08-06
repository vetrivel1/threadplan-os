import type { LearningCurvePoint, PackingType, StageCode } from "../types";
import { PACKING_DRAG } from "../types";

const DEFAULT_LEARNING_CURVE: LearningCurvePoint[] = [
  { day: 1, efficiency: 0.55 },
  { day: 2, efficiency: 0.68 },
  { day: 3, efficiency: 0.78 },
  { day: 4, efficiency: 0.86 },
  { day: 5, efficiency: 0.92 },
  { day: 6, efficiency: 0.96 },
  { day: 7, efficiency: 1.0 },
];

export function getLearningEfficiency(
  curves: Record<string, LearningCurvePoint[]>,
  styleId: string,
  dayOnStyle: number
): number {
  const curve = curves[styleId] ?? DEFAULT_LEARNING_CURVE;
  const sorted = [...curve].sort((a, b) => a.day - b.day);
  if (dayOnStyle <= 0) return sorted[0]?.efficiency ?? 0.55;
  const match = sorted.filter((p) => p.day <= dayOnStyle).pop();
  if (match) return match.efficiency;
  return sorted[sorted.length - 1]?.efficiency ?? 1.0;
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
  const effectiveMinutes = shiftMinutes * efficiency;
  const pieces = Math.floor((operators * effectiveMinutes) / (smv * packingMultiplier));
  return Math.max(0, pieces);
}

export function complexityFactor(complexity: number): number {
  return 1 + (complexity - 1) * 0.08;
}
