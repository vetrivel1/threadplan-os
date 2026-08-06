import type { StageCode, Style } from "../types";

/**
 * Sequence-dependent changeover cost.
 *
 * Historical changeover times per line are the ideal input, but no factory has
 * them cleanly on day one. This derives a defensible estimate from style
 * attributes we already hold: how far apart the two styles are in complexity,
 * and whether the fabric changes. Swap this for measured data once it exists —
 * the rest of the engine only depends on the signature.
 */

/** Floor cost of stopping one style and starting another. */
export const CHANGEOVER_BASE_MINUTES = 45;

/** Minutes added per unit of complexity distance between the two styles. */
export const COMPLEXITY_SPREAD_MINUTES = 30;

/** Extra minutes when the fabric itself changes (rethreading, tension, needles). */
export const FABRIC_CHANGE_MINUTES = 25;

/**
 * Not every stage pays the same setup cost. Sewing is the reference; cutting and
 * knitting are cheaper to retool, packing is nearly free.
 */
export const STAGE_CHANGEOVER_WEIGHT: Record<StageCode, number> = {
  knitting: 0.6,
  cutting: 0.5,
  sewing: 1.0,
  packing: 0.3,
};

export function changeoverMinutes(
  from: Style | undefined,
  to: Style,
  stage: StageCode
): number {
  if (!from) return 0;
  if (from.id === to.id) return 0;

  const complexityGap =
    Math.abs(from.complexity - to.complexity) * COMPLEXITY_SPREAD_MINUTES;
  const fabricPenalty =
    from.fabricType && to.fabricType && from.fabricType !== to.fabricType
      ? FABRIC_CHANGE_MINUTES
      : 0;

  const raw = CHANGEOVER_BASE_MINUTES + complexityGap + fabricPenalty;
  return Math.round(raw * STAGE_CHANGEOVER_WEIGHT[stage]);
}

/**
 * Cost of running `candidate` next on a line whose last style was `current`,
 * expressed in minutes. Used by the assignment strategies to prefer a line that
 * is already set up for something similar.
 */
export function changeoverAffinity(
  current: Style | undefined,
  candidate: Style,
  stage: StageCode
): number {
  return changeoverMinutes(current, candidate, stage);
}
