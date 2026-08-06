import { addDays, format, parseISO, isBefore, isAfter } from "date-fns";
import type {
  LearningCurvePoint,
  Order,
  ProductionLine,
  ScheduleCell,
  StageCode,
  Style,
} from "../types";
import { STAGE_ORDER } from "../types";
import {
  complexityFactor,
  dailyLineCapacity,
  getLearningEfficiency,
} from "./capacity";
import {
  DEFAULT_SCHEDULE_HORIZON_DAYS,
  deriveOrderStatus,
  sortOrdersBySequence,
} from "./sequencing-policy";

function dateKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function parseDate(s: string): Date {
  return parseISO(s);
}

export interface LineSplitOverride {
  orderId: string;
  stage: StageCode;
  lineIds: string[];
  ratios: number[];
}

export interface SchedulerInput {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  existingLocks?: ScheduleCell[];
  lineSplitOverrides?: LineSplitOverride[];
  startDate?: string;
  horizonDays?: number;
}

export interface SchedulerOutput {
  cells: ScheduleCell[];
  orderCompletions: Record<string, string>;
  orderStatuses: Record<string, Order["status"]>;
}

function getLinesForStage(
  lines: ProductionLine[],
  stage: StageCode
): ProductionLine[] {
  return lines.filter((l) => l.stage === stage);
}

function getLineSplit(
  overrides: LineSplitOverride[] | undefined,
  orderId: string,
  stage: StageCode
): LineSplitOverride | undefined {
  return overrides?.find((o) => o.orderId === orderId && o.stage === stage);
}

interface LineState {
  line: ProductionLine;
  cursor: Date;
  dayOnStyle: number;
  remaining: number;
}

/**
 * Split a quantity across lines by ratio using largest-remainder, so the
 * allocations always sum to exactly `total` (no ceil overshoot).
 */
function allocateAcrossLines(total: number, ratios: number[]): number[] {
  const ratioSum = ratios.reduce((s, r) => s + r, 0);
  if (ratioSum <= 0) return ratios.map(() => 0);

  const exact = ratios.map((r) => (total * r) / ratioSum);
  const allocated = exact.map(Math.floor);
  let remainder = total - allocated.reduce((s, v) => s + v, 0);

  const byLargestFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; remainder > 0 && i < byLargestFraction.length; i++) {
    allocated[byLargestFraction[i]!.index]! += 1;
    remainder -= 1;
  }

  return allocated;
}

function scheduleMultiLineStage(params: {
  order: Order;
  style: Style;
  stage: StageCode;
  linesForStage: ProductionLine[];
  totalRemaining: number;
  rmDate: Date;
  start: Date;
  end: Date;
  learningCurves: Record<string, LearningCurvePoint[]>;
  locksByKey: Map<string, ScheduleCell>;
  lineBusyUntil: Map<string, string>;
  stageCompletion: Map<string, Record<StageCode, string>>;
  lineSplit?: LineSplitOverride;
}): { cells: ScheduleCell[]; completionDate?: string; completed: boolean } {
  const {
    order,
    style,
    stage,
    linesForStage,
    totalRemaining,
    rmDate,
    start,
    end,
    learningCurves,
    locksByKey,
    lineBusyUntil,
    lineSplit,
  } = params;

  const smv = style.smv[stage] * complexityFactor(style.complexity);
  const cells: ScheduleCell[] = [];

  // Ratios follow the caller's lineIds order, so bind them by id rather than
  // by position in the (catalog-ordered) lines array.
  const ratios = lineSplit
    ? linesForStage.map((line) => {
        const idx = lineSplit.lineIds.indexOf(line.id);
        return idx >= 0 ? (lineSplit.ratios[idx] ?? 0) : 0;
      })
    : linesForStage.map(() => 1);

  const allocations = allocateAcrossLines(totalRemaining, ratios);

  const lineStates: LineState[] = linesForStage.map((line, idx) => {
    const lineFree = lineBusyUntil.get(line.id);
    let cursor = start;
    if (lineFree) {
      const nextFree = addDays(parseDate(lineFree), 1);
      if (isAfter(nextFree, cursor)) cursor = nextFree;
    }
    if (isBefore(cursor, rmDate)) cursor = rmDate;

    return {
      line,
      cursor,
      dayOnStyle: 0,
      remaining: allocations[idx] ?? 0,
    };
  });

  let lastCompletionDate: string | undefined;
  const globalEnd = end;
  const lastDateUsedByLine = new Map<string, string>();

  while (lineStates.some((ls) => ls.remaining > 0)) {
    let progressed = false;

    const candidates = lineStates
      .filter((ls) => ls.remaining > 0 && isBefore(ls.cursor, globalEnd))
      .sort((a, b) => a.cursor.getTime() - b.cursor.getTime());

    for (const ls of candidates) {
      const dk = dateKey(ls.cursor);
      const lockKey = `${order.id}:${stage}:${dk}:${ls.line.id}`;
      const locked = locksByKey.get(lockKey);

      ls.dayOnStyle += 1;
      const efficiency = getLearningEfficiency(
        learningCurves,
        order.styleId,
        ls.dayOnStyle
      );

      let qty: number;
      let lockedFlag = false;
      let status: ScheduleCell["status"] = "planned";

      if (locked && locked.lineId === ls.line.id) {
        qty = locked.actualQty ?? locked.plannedQty;
        lockedFlag = true;
        status = locked.actualQty != null ? "actual" : "locked";
      } else if (locked) {
        ls.cursor = addDays(ls.cursor, 1);
        continue;
      } else {
        const cap = dailyLineCapacity(
          ls.line.operators,
          ls.line.shiftMinutes,
          smv,
          efficiency * ls.line.efficiencyBaseline,
          order.packingType,
          stage
        );
        qty = Math.min(ls.remaining, cap);
      }

      if (qty > 0) {
        cells.push({
          id: `${order.id}-${ls.line.id}-${stage}-${dk}`,
          orderId: order.id,
          lineId: ls.line.id,
          stage,
          date: dk,
          plannedQty: locked?.plannedQty ?? qty,
          actualQty: locked?.actualQty ?? null,
          locked: lockedFlag,
          status,
          efficiency,
          capacityUsed: qty,
        });
        ls.remaining = Math.max(0, ls.remaining - qty);
        lastCompletionDate = dk;
        progressed = true;
        lastDateUsedByLine.set(ls.line.id, dk);
      }

      ls.cursor = addDays(ls.cursor, 1);
    }

    if (!progressed) break;
  }

  // A line that ran out of horizon with work left is still occupied — mark it
  // busy so the next order does not double-book the same days.
  for (const [lineId, date] of lastDateUsedByLine) {
    const existing = lineBusyUntil.get(lineId);
    if (!existing || existing < date) lineBusyUntil.set(lineId, date);
  }

  const completed = lineStates.every((ls) => ls.remaining <= 0);

  return { cells, completionDate: lastCompletionDate, completed };
}

export function buildSchedule(input: SchedulerInput): SchedulerOutput {
  const {
    orders,
    styles,
    lines,
    learningCurves,
    existingLocks = [],
    lineSplitOverrides = [],
    startDate = format(new Date(), "yyyy-MM-dd"),
    horizonDays = DEFAULT_SCHEDULE_HORIZON_DAYS,
  } = input;

  const styleMap = new Map(styles.map((s) => [s.id, s]));
  const locksByKey = new Map(
    existingLocks
      .filter((c) => c.locked)
      .map((c) => [`${c.orderId}:${c.stage}:${c.date}:${c.lineId}`, c])
  );

  const sortedOrders = sortOrdersBySequence(orders);

  const cells: ScheduleCell[] = [];
  const lineBusyUntil = new Map<string, string>();
  const stageCompletion = new Map<string, Record<StageCode, string>>();
  const orderCompletions: Record<string, string> = {};
  const orderStatuses: Record<string, Order["status"]> = {};

  const start = parseDate(startDate);
  const end = addDays(start, horizonDays);

  for (const order of sortedOrders) {
    const style = styleMap.get(order.styleId);
    if (!style) continue;

    const rmDate = parseDate(order.rmInHouseDate);
    let orderCursor = isBefore(start, rmDate) ? rmDate : start;
    const orderCells: ScheduleCell[] = [];

    for (const stage of STAGE_ORDER) {
      const linesForStage = getLinesForStage(lines, stage);
      if (linesForStage.length === 0) continue;

      const prevStage = STAGE_ORDER[STAGE_ORDER.indexOf(stage) - 1];
      if (prevStage) {
        const prevComplete = stageCompletion.get(order.id)?.[prevStage];
        if (prevComplete) {
          const prevDate = parseDate(prevComplete);
          if (isAfter(prevDate, orderCursor)) {
            orderCursor = addDays(prevDate, 1);
          }
        }
      }

      const lineSplit = getLineSplit(lineSplitOverrides, order.id, stage);
      const splitLines = lineSplit
        ? linesForStage.filter((l) => lineSplit.lineIds.includes(l.id))
        : linesForStage;

      const activeLines = splitLines.length > 0 ? splitLines : linesForStage;

      // Output already locked before this stage's window is banked, not replanned.
      // Locks inside the window are consumed by the scheduling loop itself.
      const windowStart = dateKey(orderCursor);
      let alreadyProduced = 0;
      for (const lock of existingLocks) {
        if (!lock.locked) continue;
        if (lock.orderId !== order.id || lock.stage !== stage) continue;
        if (lock.date >= windowStart) continue;
        alreadyProduced += lock.actualQty ?? lock.plannedQty;
      }

      const { cells: stageCells, completionDate } = scheduleMultiLineStage({
        order,
        style,
        stage,
        linesForStage: activeLines,
        totalRemaining: Math.max(0, order.quantity - alreadyProduced),
        rmDate,
        start: orderCursor,
        end,
        learningCurves,
        locksByKey,
        lineBusyUntil,
        stageCompletion,
        lineSplit,
      });

      orderCells.push(...stageCells);

      if (completionDate) {
        const completion =
          stageCompletion.get(order.id) ?? ({} as Record<StageCode, string>);
        completion[stage] = completionDate;
        stageCompletion.set(order.id, completion);
        orderCursor = addDays(parseDate(completionDate), 1);
      }
    }

    cells.push(...orderCells);
    const packingComplete = stageCompletion.get(order.id)?.packing;
    if (packingComplete) {
      orderCompletions[order.id] = packingComplete;
      orderStatuses[order.id] = deriveOrderStatus(
        packingComplete,
        order.deliveryDeadline
      );
    } else {
      orderStatuses[order.id] = "planned";
    }
  }

  return { cells, orderCompletions, orderStatuses };
}

export function getMaterialGates(orders: Order[], cells: ScheduleCell[]) {
  return orders.map((order) => {
    const firstCell = cells
      .filter((c) => c.orderId === order.id)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      rmInHouseDate: order.rmInHouseDate,
      earliestStart: firstCell?.date ?? order.rmInHouseDate,
      blocked: firstCell ? firstCell.date < order.rmInHouseDate : false,
    };
  });
}
