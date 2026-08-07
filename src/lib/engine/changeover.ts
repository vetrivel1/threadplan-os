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
  linking: 0.5,
  finishing: 0.3,
  wash: 0.2,
  packing: 0.3,
  dispatch: 0.1,
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

/** Floor cost of switching colour on a line: rethread, first-off, approval. */
export const COLOUR_CHANGE_MINUTES = 20;

/**
 * Extra minutes for the full cleardown a light shade needs after a dark one.
 * Scaled by how far up the shade scale the change goes.
 */
export const LIGHT_AFTER_DARK_MINUTES = 40;

/** Extra minutes when the thread shade changes independently of the body. */
export const THREAD_CHANGE_MINUTES = 15;

/**
 * Shade scale, 0 darkest to 1 lightest.
 *
 * A lookup keeps this honest about what it is: a stand-in until the factory
 * supplies its own shade groupings, which is the same posture the style-based
 * changeover estimate takes. Unknown colours sit mid-scale so they never
 * fabricate a cleardown penalty.
 */
export const COLOUR_LIGHTNESS: Record<string, number> = {
  white: 1.0,
  sand: 0.8,
  heather: 0.65,
  forest: 0.35,
  navy: 0.25,
  charcoal: 0.2,
  black: 0.0,
};

const UNKNOWN_LIGHTNESS = 0.5;

function lightnessOf(colour: string): number {
  return COLOUR_LIGHTNESS[colour.trim().toLowerCase()] ?? UNKNOWN_LIGHTNESS;
}

export interface ColourState {
  colour: string;
  thread?: string;
}

/**
 * Cost of switching a line from one colourway to another.
 *
 * Deliberately asymmetric. Running a light shade after a dark one needs the
 * machine cleared down or it contaminates the batch; going the other way is
 * close to free. A symmetric distance would price these the same and let the
 * optimizer sequence dark-to-light as cheaply as light-to-dark, which is the
 * opposite of how a dyehouse plans.
 */
export function colourChangeMinutes(
  from: ColourState | undefined,
  to: ColourState,
  stage: StageCode
): number {
  if (!from) return 0;

  const bodyChanged = from.colour !== to.colour;
  const threadChanged = (from.thread ?? from.colour) !== (to.thread ?? to.colour);
  if (!bodyChanged && !threadChanged) return 0;

  let raw = bodyChanged ? COLOUR_CHANGE_MINUTES : 0;

  if (bodyChanged) {
    const lift = lightnessOf(to.colour) - lightnessOf(from.colour);
    if (lift > 0) raw += lift * LIGHT_AFTER_DARK_MINUTES;
  }
  if (threadChanged) raw += THREAD_CHANGE_MINUTES;

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
