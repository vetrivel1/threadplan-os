import type { Order, PackRatio, ScheduleCell, StageCode } from "../types";

/**
 * Pack-ratio physics.
 *
 * The statement's complaint is that pack ratio never reaches production: a
 * carton needs 10 small, 10 medium and 10 large, so stitching 100 small then
 * 100 medium closes nothing until the large run starts. The units already
 * stitched are not progress — they are work in progress sitting on the floor.
 *
 * That observation collapses two requirements into one measure. Units produced
 * that cannot yet close a carton *are* the WIP, so `wipUnitDays` below serves
 * as both the pack-ratio sequencing signal and the missing WIP term in the
 * objective. It is deliberately expressed in unit-days, which is the same shape
 * as the "WIP days on floor" baseline the customer is being asked for.
 */

/** Size key used for orders that carry no size breakdown. */
export const UNSIZED = "__unsized";

/**
 * How an order's sizes are drawn down as production proceeds.
 *
 * `sizeBlocked` is the behaviour the statement describes: run one size to
 * exhaustion, then the next. `ratio` draws every size in proportion to the
 * carton, so cartons close continuously. Making this an input rather than a
 * constant is what turns pack ratio into a decision the engine can be scored
 * on instead of a rule bolted onto the scheduler.
 */
export type SizeMixPolicy = "ratio" | "sizeBlocked";

export const SIZE_MIX_POLICIES: SizeMixPolicy[] = ["ratio", "sizeBlocked"];

/** Sizes in a stable order — carton ratio first, then any extras. */
export function sizeOrderFor(order: Order): string[] {
  const seen: string[] = [];
  const push = (s: string) => {
    if (!seen.includes(s)) seen.push(s);
  };

  if (order.packRatio) Object.keys(order.packRatio.sizes).forEach(push);
  for (const cw of order.colourways ?? []) {
    for (const s of cw.sizes) push(s.size);
  }
  if (seen.length === 0) seen.push(UNSIZED);
  return seen;
}

/** Total quantity per size across every colourway. */
export function quantityBySize(order: Order): Record<string, number> {
  const out: Record<string, number> = {};
  if (!order.colourways || order.colourways.length === 0) {
    out[UNSIZED] = order.quantity;
    return out;
  }
  for (const cw of order.colourways) {
    for (const { size, qty } of cw.sizes) {
      out[size] = (out[size] ?? 0) + qty;
    }
  }
  return out;
}

/** Sum of a per-size map. */
export function totalOf(bySize: Record<string, number>): number {
  return Object.values(bySize).reduce((sum, v) => sum + v, 0);
}

/**
 * Scale a per-size map so it sums to exactly `total`.
 *
 * Used when part of an order is already banked: the remaining work keeps the
 * order's size profile rather than silently reverting to an even split.
 * Largest-remainder keeps the parts summing to the whole.
 */
export function scaleToTotal(
  bySize: Record<string, number>,
  sizeOrder: string[],
  total: number
): Record<string, number> {
  const current = totalOf(bySize);
  const out: Record<string, number> = {};
  if (total <= 0 || current <= 0) {
    for (const size of sizeOrder) out[size] = 0;
    return out;
  }

  const exact = sizeOrder.map((size) => ((bySize[size] ?? 0) * total) / current);
  const floored = exact.map(Math.floor);
  let remainder = total - floored.reduce((s, v) => s + v, 0);

  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; remainder > 0 && i < byFraction.length; i++) {
    floored[byFraction[i]!.index]! += 1;
    remainder -= 1;
  }

  sizeOrder.forEach((size, i) => {
    out[size] = floored[i] ?? 0;
  });
  return out;
}

/** One colour of an order still to be produced, broken down by size. */
export interface ColourRun {
  colour: string;
  thread?: string;
  remaining: Record<string, number>;
}

/** Colour used for orders that carry no colourway breakdown. */
export const UNCOLOURED = "__uncoloured";

/**
 * The queue of colour runs a line works through, scaled to that line's share.
 *
 * A line runs one colour at a time, so this is the order in which it will pick
 * them up. Scaling happens across colourways first and then within each one, so
 * the parts still sum to the line's allocation exactly.
 */
export function buildColourQueue(order: Order, total: number): ColourRun[] {
  const sizeOrder = sizeOrderFor(order);

  if (!order.colourways || order.colourways.length === 0) {
    return [
      {
        colour: UNCOLOURED,
        remaining: scaleToTotal(quantityBySize(order), sizeOrder, total),
      },
    ];
  }

  const colourTotals = order.colourways.map((cw) =>
    cw.sizes.reduce((sum, s) => sum + s.qty, 0)
  );
  const colourNames = order.colourways.map((cw) => cw.colour);
  const scaledTotals = scaleToTotal(
    Object.fromEntries(colourNames.map((c, i) => [c, colourTotals[i] ?? 0])),
    colourNames,
    total
  );

  return order.colourways.map((cw) => {
    const bySize: Record<string, number> = {};
    for (const { size, qty } of cw.sizes) {
      bySize[size] = (bySize[size] ?? 0) + qty;
    }
    return {
      colour: cw.colour,
      thread: cw.thread,
      remaining: scaleToTotal(bySize, sizeOrder, scaledTotals[cw.colour] ?? 0),
    };
  });
}

/**
 * Choose which sizes make up one cell's output.
 *
 * Never returns more than `qty`, and never more of a size than remains.
 */
export function takeSizeMix(params: {
  remaining: Record<string, number>;
  sizeOrder: string[];
  qty: number;
  policy: SizeMixPolicy;
  packRatio?: PackRatio;
}): Record<string, number> {
  const { remaining, sizeOrder, qty, policy, packRatio } = params;
  const mix: Record<string, number> = {};
  if (qty <= 0) return mix;

  const available = sizeOrder.filter((s) => (remaining[s] ?? 0) > 0);
  if (available.length === 0) return mix;

  if (policy === "sizeBlocked" || available.length === 1) {
    let left = qty;
    for (const size of available) {
      if (left <= 0) break;
      const take = Math.min(left, remaining[size] ?? 0);
      if (take > 0) {
        mix[size] = take;
        left -= take;
      }
    }
    return mix;
  }

  // Ratio draw: weight by the carton for assorted packs, and by what is left
  // for solid packs (where no cross-size ratio exists to honour).
  const weightFor = (size: string): number => {
    if (packRatio && packRatio.mode === "assorted") {
      return packRatio.sizes[size] ?? 0;
    }
    return remaining[size] ?? 0;
  };

  const weights = available.map(weightFor);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) {
    return takeSizeMix({ ...params, policy: "sizeBlocked" });
  }

  const exact = weights.map((w) => (qty * w) / weightSum);
  const draft = exact.map((v, i) =>
    Math.min(Math.floor(v), remaining[available[i]!] ?? 0)
  );

  let left = qty - draft.reduce((s, v) => s + v, 0);

  // Hand out the rounding remainder, then any units the caps displaced,
  // largest fractional part first so the draw stays deterministic.
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let pass = 0; pass < 2 && left > 0; pass++) {
    for (const { index } of byFraction) {
      if (left <= 0) break;
      const size = available[index]!;
      const headroom = (remaining[size] ?? 0) - (draft[index] ?? 0);
      if (headroom <= 0) continue;
      const take = pass === 0 ? Math.min(1, headroom, left) : Math.min(headroom, left);
      draft[index] = (draft[index] ?? 0) + take;
      left -= take;
    }
  }

  available.forEach((size, i) => {
    if ((draft[i] ?? 0) > 0) mix[size] = draft[i]!;
  });
  return mix;
}

/** Subtract a mix from a remaining map, in place. */
export function subtractMix(
  remaining: Record<string, number>,
  mix: Record<string, number>
): void {
  for (const [size, qty] of Object.entries(mix)) {
    remaining[size] = Math.max(0, (remaining[size] ?? 0) - qty);
  }
}

/**
 * Units that can actually ship, given what has been produced so far.
 *
 * Assorted cartons are limited by the scarcest size; solid cartons close per
 * size independently. Anything produced beyond this is stranded on the floor.
 */
export function shippableUnits(
  cumulative: Record<string, number>,
  packRatio?: PackRatio
): number {
  const produced = totalOf(cumulative);
  if (produced <= 0) return 0;
  if (!packRatio || packRatio.unitsPerCarton <= 0) return produced;

  if (packRatio.mode === "solid") {
    let shipped = 0;
    for (const qty of Object.values(cumulative)) {
      shipped += Math.floor(qty / packRatio.unitsPerCarton) * packRatio.unitsPerCarton;
    }
    return shipped;
  }

  const ratioSizes = Object.entries(packRatio.sizes).filter(([, n]) => n > 0);
  if (ratioSizes.length === 0) return produced;

  let cartons = Infinity;
  for (const [size, perCarton] of ratioSizes) {
    cartons = Math.min(cartons, Math.floor((cumulative[size] ?? 0) / perCarton));
  }
  if (!Number.isFinite(cartons) || cartons <= 0) return 0;
  return cartons * packRatio.unitsPerCarton;
}

/** Produced but not yet shippable — the WIP on the floor. */
export function strandedUnits(
  cumulative: Record<string, number>,
  packRatio?: PackRatio
): number {
  return Math.max(0, totalOf(cumulative) - shippableUnits(cumulative, packRatio));
}

/**
 * WIP carried across the plan, in unit-days.
 *
 * Measured at the operation that decides carton closability — sewing feeds
 * packing, so it is sewing output that either closes cartons or piles up. Each
 * day an order's stranded units are counted once, so a size imbalance left
 * standing for a week costs seven times one left standing for a day.
 *
 * Cartons are counted per colour: a Navy carton cannot be closed with White
 * pieces, so pooling sizes across colourways would report stock as shippable
 * when the floor could not actually pack it.
 */
export function wipUnitDays(params: {
  orders: Order[];
  cells: ScheduleCell[];
  stage?: StageCode;
}): number {
  const { orders, cells, stage = "sewing" } = params;
  const relevant = cells.filter((c) => c.stage === stage && c.sizeMix);
  if (relevant.length === 0) return 0;

  const byOrder = new Map<string, ScheduleCell[]>();
  for (const cell of relevant) {
    const list = byOrder.get(cell.orderId);
    if (list) list.push(cell);
    else byOrder.set(cell.orderId, [cell]);
  }

  let total = 0;
  for (const order of orders) {
    const orderCells = byOrder.get(order.id);
    if (!orderCells) continue;

    const dates = [...new Set(orderCells.map((c) => c.date))].sort();
    const lastDate = dates[dates.length - 1]!;
    const cumulativeByColour = new Map<string, Record<string, number>>();

    for (const date of dates) {
      for (const cell of orderCells) {
        if (cell.date !== date) continue;
        const colour = cell.colour ?? UNCOLOURED;
        let cumulative = cumulativeByColour.get(colour);
        if (!cumulative) {
          cumulative = {};
          cumulativeByColour.set(colour, cumulative);
        }
        for (const [size, qty] of Object.entries(cell.sizeMix ?? {})) {
          cumulative[size] = (cumulative[size] ?? 0) + qty;
        }
      }
      // Stranded stock on the final day is the order finishing, not WIP being
      // carried, so it is not charged.
      if (date !== lastDate) {
        for (const cumulative of cumulativeByColour.values()) {
          total += strandedUnits(cumulative, order.packRatio);
        }
      }
    }
  }
  return total;
}
