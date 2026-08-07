import { format, parseISO, isAfter } from "date-fns";
import type {
  LearningCurvePoint,
  Order,
  ProductionLine,
  RippleEdit,
  RippleResult,
  ScheduleCell,
  Style,
} from "../types";
import { buildSchedule, type LineSplitOverride } from "./scheduler";
import { REPLAN_HORIZON_DAYS } from "./sequencing-policy";

export interface RippleInput {
  orderId: string;
  lineId: string;
  stage: ScheduleCell["stage"];
  date: string;
  actualQty: number;
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  cells: ScheduleCell[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  lineSplitOverrides?: LineSplitOverride[];
}

export function applyRipple(input: RippleInput): RippleResult {
  const {
    orderId,
    lineId,
    stage,
    date,
    actualQty,
    orders,
    styles,
    lines,
    cells,
    learningCurves,
  } = input;

  const target = cells.find(
    (c) =>
      c.orderId === orderId &&
      c.lineId === lineId &&
      c.stage === stage &&
      c.date === date
  );

  if (!target) {
    return {
      updatedCells: cells,
      affectedOrders: [],
      newProjections: {},
      warnings: ["Cell not found for ripple edit."],
    };
  }

  const variance = actualQty - target.plannedQty;
  const warnings: string[] = [];

  if (variance < 0) {
    warnings.push(
      `Shortfall of ${Math.abs(variance)} pcs will cascade across remaining schedule.`
    );
  }

  const lockedCells: ScheduleCell[] = cells.map((c) => {
    if (
      c.orderId === orderId &&
      c.lineId === lineId &&
      c.stage === stage &&
      c.date === date
    ) {
      return {
        ...c,
        actualQty,
        locked: true,
        status: "actual" as const,
        capacityUsed: actualQty,
      };
    }
    return c;
  });

  const allLocks = lockedCells.filter((c) => c.locked);

  const rescheduled = buildSchedule({
    orders,
    styles,
    lines,
    learningCurves,
    existingLocks: allLocks,
    lineSplitOverrides: input.lineSplitOverrides,
    startDate: format(new Date(), "yyyy-MM-dd"),
    horizonDays: REPLAN_HORIZON_DAYS,
  });

  const affectedOrders = new Set<string>([orderId]);
  for (const cell of rescheduled.cells) {
    const prev = lockedCells.find(
      (c) =>
        c.orderId === cell.orderId &&
        c.stage === cell.stage &&
        c.lineId === cell.lineId &&
        c.date === cell.date &&
        !c.locked
    );
    if (prev && prev.plannedQty !== cell.plannedQty) {
      affectedOrders.add(cell.orderId);
    }
  }

  const newProjections: Record<string, string> = {};
  for (const oid of affectedOrders) {
    newProjections[oid] = rescheduled.orderCompletions[oid] ?? "";
  }

  for (const oid of affectedOrders) {
    const o = orders.find((x) => x.id === oid);
    if (!o) continue;
    const completion = rescheduled.orderCompletions[oid];
    if (completion && isAfter(parseISO(completion), parseISO(o.deliveryDeadline))) {
      warnings.push(
        `Order ${o.orderNumber} now projected past delivery deadline (${o.deliveryDeadline}).`
      );
    }
  }

  const mergedCells = mergeCells(lockedCells, rescheduled.cells);

  return {
    updatedCells: mergedCells,
    affectedOrders: [...affectedOrders],
    newProjections,
    warnings,
  };
}

export interface BulkRippleInput {
  edits: RippleEdit[];
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  cells: ScheduleCell[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  lineSplitOverrides?: LineSplitOverride[];
}

function cellKey(c: {
  orderId: string;
  lineId: string;
  stage: ScheduleCell["stage"];
  date: string;
}): string {
  return `${c.orderId}:${c.lineId}:${c.stage}:${c.date}`;
}

/**
 * The multi-cell counterpart to `applyRipple` — lock every edited cell first,
 * then replan once. Daily output is recorded per (line, date), not per order,
 * so a floor with N active lines produces N edits in one submission rather
 * than N separate cascades: `buildSchedule` runs exactly once regardless of
 * how many lines reported output that day.
 */
export function applyBulkRipple(input: BulkRippleInput): RippleResult {
  const { edits, orders, styles, lines, cells, learningCurves } = input;

  if (edits.length === 0) {
    return { updatedCells: cells, affectedOrders: [], newProjections: {}, warnings: [] };
  }

  const editByKey = new Map(edits.map((e) => [cellKey(e), e]));
  const warnings: string[] = [];
  const foundKeys = new Set<string>();

  const lockedCells: ScheduleCell[] = cells.map((c) => {
    const edit = editByKey.get(cellKey(c));
    if (!edit) return c;
    foundKeys.add(cellKey(c));

    const variance = edit.actualQty - c.plannedQty;
    if (variance < 0) {
      const order = orders.find((o) => o.id === c.orderId);
      warnings.push(
        `Shortfall of ${Math.abs(variance)} pcs on ${order?.orderNumber ?? c.orderId} (${c.stage}, ${c.date}) will cascade across remaining schedule.`
      );
    }

    return {
      ...c,
      actualQty: edit.actualQty,
      locked: true,
      status: "actual" as const,
      capacityUsed: edit.actualQty,
    };
  });

  for (const [key, edit] of editByKey) {
    if (!foundKeys.has(key)) {
      warnings.push(
        `No matching cell for order ${edit.orderId} / ${edit.stage} / ${edit.date} — entry skipped.`
      );
    }
  }

  const allLocks = lockedCells.filter((c) => c.locked);

  const rescheduled = buildSchedule({
    orders,
    styles,
    lines,
    learningCurves,
    existingLocks: allLocks,
    lineSplitOverrides: input.lineSplitOverrides,
    startDate: format(new Date(), "yyyy-MM-dd"),
    horizonDays: REPLAN_HORIZON_DAYS,
  });

  const affectedOrders = new Set<string>(edits.map((e) => e.orderId));
  for (const cell of rescheduled.cells) {
    const prev = lockedCells.find(
      (c) =>
        c.orderId === cell.orderId &&
        c.stage === cell.stage &&
        c.lineId === cell.lineId &&
        c.date === cell.date &&
        !c.locked
    );
    if (prev && prev.plannedQty !== cell.plannedQty) {
      affectedOrders.add(cell.orderId);
    }
  }

  const newProjections: Record<string, string> = {};
  for (const oid of affectedOrders) {
    newProjections[oid] = rescheduled.orderCompletions[oid] ?? "";
  }

  for (const oid of affectedOrders) {
    const o = orders.find((x) => x.id === oid);
    if (!o) continue;
    const completion = rescheduled.orderCompletions[oid];
    if (completion && isAfter(parseISO(completion), parseISO(o.deliveryDeadline))) {
      warnings.push(
        `Order ${o.orderNumber} now projected past delivery deadline (${o.deliveryDeadline}).`
      );
    }
  }

  const mergedCells = mergeCells(lockedCells, rescheduled.cells);

  return {
    updatedCells: mergedCells,
    affectedOrders: [...affectedOrders],
    newProjections,
    warnings,
  };
}

function mergeCells(locked: ScheduleCell[], fresh: ScheduleCell[]): ScheduleCell[] {
  const lockMap = new Map(
    locked.filter((c) => c.locked).map((c) => [`${c.orderId}:${c.stage}:${c.date}:${c.lineId}`, c])
  );
  const result: ScheduleCell[] = [];
  const seen = new Set<string>();

  for (const cell of fresh) {
    const key = `${cell.orderId}:${cell.stage}:${cell.date}:${cell.lineId}`;
    const lock = lockMap.get(key);
    if (lock) {
      result.push(lock);
    } else {
      result.push({ ...cell, status: "projected" });
    }
    seen.add(key);
  }

  for (const [key, lock] of lockMap) {
    if (!seen.has(key)) result.push(lock);
  }

  return result.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.orderId.localeCompare(b.orderId);
  });
}
