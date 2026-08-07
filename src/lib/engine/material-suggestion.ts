import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Order, ProductionLine, Style } from "../types";
import { RM_BUFFER_DAYS } from "./material-gate";
import { estimateRemainingLeadTime } from "./priority-score";

/**
 * Suggested material in-house dates: a backward pass from the delivery
 * deadline, rather than the forward-only "when does RM arrive" flow every
 * other part of this engine assumes as an input.
 *
 * Deliberately independent of the scheduling horizon and of whether the order
 * has actually been scheduled yet — `estimateRemainingLeadTime` only needs a
 * style and a line pool, so this answers "when do I need to place the yarn
 * order for panels I won't knit for three months" even though nothing that
 * far out would appear in a 45-day plan.
 */

export interface MaterialSuggestion {
  name: string;
  /** What is currently booked, if this order carries a material breakdown. */
  currentInHouseDate: string;
  /** What the backward pass says is actually needed. */
  suggestedInHouseDate: string;
  /** The current booking is later than what's needed — a real problem, not
   * just a modelling artifact, since the booking is a planner's own input. */
  isLate: boolean;
}

export interface OrderMaterialSuggestion {
  orderId: string;
  deliveryDeadline: string;
  estimatedLeadDays: number;
  /** The date stage one would need to start to hit the deadline exactly. */
  desiredStageOneStart: string;
  /** desiredStageOneStart minus the RM buffer — the single number this phase
   * exists to produce. */
  suggestedInHouseDate: string;
  /** Days between today and `suggestedInHouseDate`. Negative means the
   * material should already be in-house. */
  daysUntilNeeded: number;
  /**
   * One entry per listed material. All share the same suggested date today,
   * because materials aren't yet tied to which stage consumes them — every
   * material still gates the same first stage collectively. Staggering by
   * consuming stage is deferred until that link exists.
   */
  materials: MaterialSuggestion[];
}

export function suggestMaterialDates(params: {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  today: string;
}): OrderMaterialSuggestion[] {
  const { orders, styles, lines, today } = params;
  const styleMap = new Map(styles.map((s) => [s.id, s]));

  const results: OrderMaterialSuggestion[] = [];

  for (const order of orders) {
    const style = styleMap.get(order.styleId);
    if (!style) continue;

    const estimatedLeadDays = Math.ceil(
      estimateRemainingLeadTime(order, style, lines)
    );
    const desiredStageOneStart = addDaysStr(
      order.deliveryDeadline,
      -estimatedLeadDays
    );
    const suggestedInHouseDate = addDaysStr(
      desiredStageOneStart,
      -RM_BUFFER_DAYS
    );
    const daysUntilNeeded = differenceInCalendarDays(
      parseISO(suggestedInHouseDate),
      parseISO(today)
    );

    const sourceMaterials =
      order.materials && order.materials.length > 0
        ? order.materials
        : [{ name: "Raw material", inHouseDate: order.rmInHouseDate }];

    const materials: MaterialSuggestion[] = sourceMaterials.map((m) => ({
      name: m.name,
      currentInHouseDate: m.inHouseDate,
      suggestedInHouseDate,
      isLate: m.inHouseDate > suggestedInHouseDate,
    }));

    results.push({
      orderId: order.id,
      deliveryDeadline: order.deliveryDeadline,
      estimatedLeadDays,
      desiredStageOneStart,
      suggestedInHouseDate,
      daysUntilNeeded,
      materials,
    });
  }

  return results;
}

function addDaysStr(dateStr: string, days: number): string {
  return format(addDays(parseISO(dateStr), days), "yyyy-MM-dd");
}
