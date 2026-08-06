import { addDays, format, parseISO } from "date-fns";
import type { Order } from "../types";

/**
 * Days of slack between material arriving and production being allowed to start.
 * Covers inspection, shrinkage testing and issue to the floor.
 */
export const RM_BUFFER_DAYS = 1;

/**
 * The date production is actually gated on.
 *
 * An order is blocked until its *last* material lands, not its first, so when a
 * material breakdown is supplied the gate is the max across it. Orders carrying
 * only the legacy single `rmInHouseDate` fall back to that date.
 */
export function effectiveRmDate(order: Order, applyBuffer: boolean): string {
  if (!applyBuffer) return order.rmInHouseDate;

  const dates =
    order.materials && order.materials.length > 0
      ? order.materials.map((m) => m.inHouseDate)
      : [order.rmInHouseDate];

  const latest = dates.reduce((a, b) => (a > b ? a : b));
  return format(addDays(parseISO(latest), RM_BUFFER_DAYS), "yyyy-MM-dd");
}

/**
 * Which material is holding an order up, for planner-facing explanation.
 */
export function blockingMaterial(order: Order): string | undefined {
  if (!order.materials || order.materials.length === 0) return undefined;
  return order.materials.reduce((latest, m) =>
    m.inHouseDate > latest.inHouseDate ? m : latest
  ).name;
}
