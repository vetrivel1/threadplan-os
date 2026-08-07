import type {
  LearningCurvePoint,
  Order,
  ScheduleCell,
  StageCode,
  Style,
} from "../types";
import { getLearningEfficiency, lineCurveKey } from "./capacity";

/**
 * Learning curves that learn.
 *
 * Every ripple edit that records an actual quantity against a planned one is a
 * data point about how a specific style actually ran on a specific line — the
 * input this needs already exists, captured for an unrelated reason (the plan
 * needed to reflect what really happened on the floor). This module is the
 * feedback loop that was missing: turn those recorded actuals into a curve
 * that measurably improves on the complexity-tier prior, without letting a
 * handful of noisy days overwrite a model built on nothing.
 *
 * Kept at style×line granularity, matching `lineCurveKey` from the per-line
 * physics work — not style×operation×line. The engine does not key a curve by
 * stage anywhere today (`getLearningEfficiency` is never called with one), so
 * introducing that dimension here would produce a curve the scheduler has no
 * way to consume. See the "Deferred" note in the roadmap.
 */

/** How many observations it takes before the fit is trusted over the prior. */
const SHRINKAGE_K = 5;

/** A single day's ratio of actual to predicted output is clamped before
 * averaging, so one mis-keyed actual (a data-entry zero, a half day) does not
 * swing an otherwise well-behaved fit. */
const MIN_DAY_RATIO = 0.5;
const MAX_DAY_RATIO = 1.5;

export interface StyleLineObservation {
  /** Sequential day-of-experience for this style on this line, 1-based —
   * the nth calendar date with a recorded actual, not the calendar date's
   * position in the plan's own `dayOnStyle` counter. */
  day: number;
  date: string;
  stage: StageCode;
  plannedQty: number;
  actualQty: number;
  /** What the curve predicted would run that day. */
  modelEfficiency: number;
  /** actualQty / plannedQty against the model's own predicted rate — how much
   * faster or slower the floor actually ran than the plan assumed. */
  ratio: number;
}

export interface FittedLearningCurve {
  key: string;
  styleId: string;
  lineId: string;
  /** Stage the observations were drawn from. A style×line pairing that has
   * actuals recorded on more than one stage gets one fit per stage; the
   * caller decides which to feed back in, since the curve itself only keys
   * on style×line. */
  stage: StageCode;
  observations: StyleLineObservation[];
  observationCount: number;
  /** Average of the clamped per-day ratios, before shrinkage. 1.0 means the
   * floor ran exactly at the model's predicted rate. */
  bias: number;
  /** Weight given to `bias` versus the prior, 0..1. Rises with observation
   * count so three data points nudge the curve rather than replace it. */
  shrinkage: number;
  /** The blended curve: prior efficiency at each day, scaled by the shrunk
   * bias. Ready to slot into a `learningCurves` map under `key`. */
  points: LearningCurvePoint[];
}

export interface FitObservedCurvesInput {
  cells: ScheduleCell[];
  orders: Order[];
  styles: Style[];
  /** Style-wide curves to use as the prior. Deliberately not the style×line
   * map being fitted here — that would let a fit feed on itself. */
  baseCurves: Record<string, LearningCurvePoint[]>;
  /** How many days the blended curve should cover. */
  horizonDays?: number;
}

/**
 * Fits one curve per (style, stage, line) that has at least one cell with a
 * recorded `actualQty` differing from its `plannedQty`-implied rate.
 */
export function fitObservedCurves(
  input: FitObservedCurvesInput
): FittedLearningCurve[] {
  const { cells, orders, styles, baseCurves, horizonDays = 7 } = input;
  const orderStyle = new Map(orders.map((o) => [o.id, o.styleId]));
  const styleMap = new Map(styles.map((s) => [s.id, s]));

  const groups = new Map<
    string,
    { styleId: string; lineId: string; stage: StageCode; cells: ScheduleCell[] }
  >();

  for (const cell of cells) {
    if (cell.actualQty == null || cell.plannedQty <= 0) continue;
    const styleId = orderStyle.get(cell.orderId);
    if (!styleId) continue;

    const key = `${styleId}::${cell.stage}::${cell.lineId}`;
    const group = groups.get(key);
    if (group) group.cells.push(cell);
    else groups.set(key, { styleId, lineId: cell.lineId, stage: cell.stage, cells: [cell] });
  }

  const fits: FittedLearningCurve[] = [];

  for (const { styleId, lineId, stage, cells: groupCells } of groups.values()) {
    const style = styleMap.get(styleId);
    if (!style) continue;

    const sorted = [...groupCells].sort((a, b) => (a.date < b.date ? -1 : 1));
    const observations: StyleLineObservation[] = sorted.map((cell, idx) => {
      const rawRatio = cell.actualQty! / cell.plannedQty;
      const ratio = clamp(rawRatio, MIN_DAY_RATIO, MAX_DAY_RATIO);
      return {
        day: idx + 1,
        date: cell.date,
        stage,
        plannedQty: cell.plannedQty,
        actualQty: cell.actualQty!,
        modelEfficiency: cell.efficiency,
        ratio,
      };
    });

    const n = observations.length;
    const bias = observations.reduce((s, o) => s + o.ratio, 0) / n;
    const shrinkage = n / (n + SHRINKAGE_K);
    const blendedBias = 1 + shrinkage * (bias - 1);

    const priorAt = (day: number) =>
      getLearningEfficiency(baseCurves, styleId, day, style.complexity);

    const lastObservedDay = observations[n - 1]!.day;
    const days = Math.max(horizonDays, lastObservedDay);
    const points: LearningCurvePoint[] = Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      return {
        day,
        efficiency: round(clamp(priorAt(day) * blendedBias, 0, 1)),
      };
    });

    fits.push({
      key: lineCurveKey(styleId, lineId),
      styleId,
      lineId,
      stage,
      observations,
      observationCount: n,
      bias: round(bias),
      shrinkage: round(shrinkage),
      points,
    });
  }

  return fits;
}

/**
 * Layers fitted curves onto a base `learningCurves` map, ready to hand to
 * `buildSchedule` / `optimizeSchedule`. When more than one stage produced a
 * fit for the same style×line, the fit with the most observations wins,
 * since the curve itself has nowhere to record which stage it came from.
 */
export function mergeFittedCurves(
  base: Record<string, LearningCurvePoint[]>,
  fitted: FittedLearningCurve[]
): Record<string, LearningCurvePoint[]> {
  const merged = { ...base };
  const bestByKey = new Map<string, FittedLearningCurve>();
  for (const fit of fitted) {
    const existing = bestByKey.get(fit.key);
    if (!existing || fit.observationCount > existing.observationCount) {
      bestByKey.set(fit.key, fit);
    }
  }
  for (const fit of bestByKey.values()) {
    merged[fit.key] = fit.points;
  }
  return merged;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
