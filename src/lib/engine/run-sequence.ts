import type { LearningCurvePoint, Order, ProductionLine, ScheduleCell, Style } from "@/lib/types";
import { buildSchedule } from "./scheduler";
import { SEQUENCE_HORIZON_DAYS } from "./sequencing-policy";

export interface AutoSequenceInput {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  existingLocks?: ScheduleCell[];
  horizonDays?: number;
}

export function runAutoSequence(input: AutoSequenceInput) {
  const result = buildSchedule({
    orders: input.orders,
    styles: input.styles,
    lines: input.lines,
    learningCurves: input.learningCurves,
    existingLocks: input.existingLocks ?? [],
    horizonDays: input.horizonDays ?? SEQUENCE_HORIZON_DAYS,
  });

  const orders = input.orders.map((o) => ({
    ...o,
    status: result.orderStatuses[o.id] ?? o.status,
  }));

  return { cells: result.cells, orders, orderCompletions: result.orderCompletions };
}
