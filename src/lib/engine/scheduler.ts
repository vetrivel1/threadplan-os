import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  isBefore,
  isAfter,
} from "date-fns";
import type {
  LearningCurvePoint,
  MaterialGate,
  Order,
  ProductionLine,
  ScheduleCell,
  StageCode,
  Style,
} from "../types";
import { STAGE_ORDER, smvFor, stagesForRoute } from "../types";
import {
  complexityFactor,
  dailyLineCapacity,
  getLearningEfficiency,
  retainedDaysOnStyle,
} from "./capacity";
import {
  changeoverMinutes,
  colourChangeMinutes,
  type ColourState,
} from "./changeover";
import { effectiveRmDate } from "./material-gate";
import {
  buildColourQueue,
  sizeOrderFor,
  subtractMix,
  takeSizeMix,
  totalOf,
  type ColourRun,
  type SizeMixPolicy,
} from "./pack-ratio";
import { resolvePhysics, type PhysicsOptions } from "./physics";
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

/**
 * Which lines an order runs on for a stage, and in what proportion.
 *
 * When absent the order spreads across every line in the stage. Narrowing this
 * to a single line is what lets two orders run in parallel on different lines,
 * and is the decision variable the optimizer searches over.
 */
export interface LineAssignment {
  orderId: string;
  stage: StageCode;
  lineIds: string[];
  ratios: number[];
}

/** @deprecated Renamed to `LineAssignment`. */
export type LineSplitOverride = LineAssignment;

export interface SchedulerInput {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  existingLocks?: ScheduleCell[];
  lineAssignments?: LineAssignment[];
  /** @deprecated Use `lineAssignments`. */
  lineSplitOverrides?: LineAssignment[];
  /** Explicit order of order ids. Falls back to the deadline+priority sort. */
  sequence?: string[];
  /**
   * How each order's sizes are drawn down. A decision variable, not a setting:
   * drawing in carton ratio closes cartons continuously, while running one size
   * to exhaustion strands everything until the last size starts.
   */
  sizeMixPolicy?: SizeMixPolicy;
  startDate?: string;
  horizonDays?: number;
  physics?: Partial<PhysicsOptions>;
}

export interface SchedulerOutput {
  cells: ScheduleCell[];
  orderCompletions: Record<string, string>;
  orderStatuses: Record<string, Order["status"]>;
  /** Total setup minutes lost to style changes across every line. */
  changeoverMinutes: number;
  changeoverByLine: Record<string, number>;
}

function getLinesForStage(
  lines: ProductionLine[],
  stage: StageCode
): ProductionLine[] {
  return lines.filter((l) => l.stage === stage);
}

function getAssignment(
  assignments: LineAssignment[] | undefined,
  orderId: string,
  stage: StageCode
): LineAssignment | undefined {
  return assignments?.find((o) => o.orderId === orderId && o.stage === stage);
}

interface LineState {
  line: ProductionLine;
  cursor: Date;
  dayOnStyle: number;
  remaining: number;
  /** Setup minutes owed before this line's first productive day on the order. */
  setupMinutes: number;
  setupApplied: boolean;
  historyKey: string;
  /** Colours this line still has to run, in order. Undefined when unmodelled. */
  colourQueue?: ColourRun[];
  colourIndex: number;
  /** What the line is currently threaded for. */
  activeColour?: ColourState;
}

interface StyleRunHistory {
  days: number;
  lastDate: string;
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
  styleMap: Map<string, Style>;
  stage: StageCode;
  linesForStage: ProductionLine[];
  totalRemaining: number;
  rmDate: Date;
  start: Date;
  end: Date;
  learningCurves: Record<string, LearningCurvePoint[]>;
  locksByKey: Map<string, ScheduleCell>;
  lineBusyUntil: Map<string, string>;
  lineLastStyle: Map<string, string>;
  lineLastColour: Map<string, ColourState>;
  lineStyleHistory: Map<string, StyleRunHistory>;
  physics: PhysicsOptions;
  sizeMixPolicy: SizeMixPolicy;
  assignment?: LineAssignment;
}): {
  cells: ScheduleCell[];
  completionDate?: string;
  completed: boolean;
  changeoverByLine: Record<string, number>;
} {
  const {
    order,
    style,
    styleMap,
    stage,
    linesForStage,
    totalRemaining,
    rmDate,
    start,
    end,
    learningCurves,
    locksByKey,
    lineBusyUntil,
    lineLastStyle,
    lineLastColour,
    lineStyleHistory,
    physics,
    sizeMixPolicy,
    assignment,
  } = params;

  const sizeOrder = sizeOrderFor(order);

  // Complexity now drives the learning ramp rather than scaling SMV, which the
  // per-style SMV already reflects. The legacy factor stays available so the
  // parity check can reproduce pre-MCOE output. Line-specific, since two
  // lines can run the same style at different rates once tooling differs.
  const smvForLine = (lineId: string): number => {
    const base = smvFor(style, stage, physics.perLineRates ? lineId : undefined);
    return physics.complexityCurves
      ? base
      : base * complexityFactor(style.complexity);
  };

  const cells: ScheduleCell[] = [];
  const changeoverByLine: Record<string, number> = {};

  // Ratios follow the caller's lineIds order, so bind them by id rather than
  // by position in the (catalog-ordered) lines array.
  const ratios = assignment
    ? linesForStage.map((line) => {
        const idx = assignment.lineIds.indexOf(line.id);
        return idx >= 0 ? (assignment.ratios[idx] ?? 0) : 0;
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

    const previousStyleId = lineLastStyle.get(line.id);
    const previousStyle = previousStyleId
      ? styleMap.get(previousStyleId)
      : undefined;
    const setupMinutes = physics.changeover
      ? changeoverMinutes(previousStyle, style, stage)
      : 0;

    const historyKey = `${line.id}:${style.id}`;
    let dayOnStyle = 0;
    if (physics.learningRetention) {
      const history = lineStyleHistory.get(historyKey);
      if (history) {
        const idleDays = differenceInCalendarDays(
          cursor,
          parseDate(history.lastDate)
        );
        dayOnStyle = retainedDaysOnStyle(history.days, idleDays);
      }
    }

    return {
      line,
      cursor,
      dayOnStyle,
      remaining: allocations[idx] ?? 0,
      setupMinutes,
      setupApplied: setupMinutes === 0,
      historyKey,
      // Each line works its own share of every colourway, so the parts still
      // sum to the order.
      colourQueue: physics.packRatioSequencing
        ? buildColourQueue(order, allocations[idx] ?? 0)
        : undefined,
      colourIndex: 0,
      activeColour: lineLastColour.get(line.id),
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
        ls.dayOnStyle,
        physics.complexityCurves ? style.complexity : undefined,
        physics.perLineRates ? ls.line.id : undefined
      );

      // A line is threaded for one colour at a time. Step past colours it has
      // already finished, then price the rethread onto this day's shift.
      let activeRun: ColourRun | undefined;
      if (ls.colourQueue) {
        while (
          ls.colourIndex < ls.colourQueue.length &&
          totalOf(ls.colourQueue[ls.colourIndex]!.remaining) <= 0
        ) {
          ls.colourIndex += 1;
        }
        activeRun = ls.colourQueue[ls.colourIndex];
      }
      const colourSetup =
        activeRun && physics.colourChangeover
          ? colourChangeMinutes(ls.activeColour, activeRun, stage)
          : 0;

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
        // Both setups are paid out of the same shift: the style change on the
        // line's first productive day, the rethread whenever colour switches.
        const base = ls.setupApplied
          ? ls.line.shiftMinutes
          : ls.line.shiftMinutes - ls.setupMinutes;
        const availableMinutes = Math.max(0, base - colourSetup);

        const cap = dailyLineCapacity(
          ls.line.operators,
          availableMinutes,
          smvForLine(ls.line.id),
          efficiency * ls.line.efficiencyBaseline,
          order.packingType,
          stage
        );
        // A day cannot produce more of a colour than is left of it; the next
        // colour starts tomorrow, after its own rethread.
        const colourCap = activeRun
          ? totalOf(activeRun.remaining)
          : Number.POSITIVE_INFINITY;
        qty = Math.min(ls.remaining, colourCap, cap);
      }

      if (qty > 0) {
        if (!ls.setupApplied) {
          ls.setupApplied = true;
          changeoverByLine[ls.line.id] =
            (changeoverByLine[ls.line.id] ?? 0) + ls.setupMinutes;
        }

        if (colourSetup > 0) {
          changeoverByLine[ls.line.id] =
            (changeoverByLine[ls.line.id] ?? 0) + colourSetup;
        }
        if (activeRun) {
          ls.activeColour = { colour: activeRun.colour, thread: activeRun.thread };
          lineLastColour.set(ls.line.id, ls.activeColour);
        }

        let sizeMix: Record<string, number> | undefined;
        if (activeRun) {
          sizeMix = takeSizeMix({
            remaining: activeRun.remaining,
            sizeOrder,
            qty,
            policy: sizeMixPolicy,
            packRatio: order.packRatio,
          });
          subtractMix(activeRun.remaining, sizeMix);
        }

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
          ...(sizeMix ? { sizeMix } : {}),
          ...(activeRun ? { colour: activeRun.colour } : {}),
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

  // Remember what each line last ran and how far up the curve it got, so a
  // repeat run of the same style does not start from scratch.
  for (const ls of lineStates) {
    const lastDate = lastDateUsedByLine.get(ls.line.id);
    if (!lastDate) continue;
    lineLastStyle.set(ls.line.id, style.id);
    lineStyleHistory.set(ls.historyKey, {
      days: ls.dayOnStyle,
      lastDate,
    });
  }

  const completed = lineStates.every((ls) => ls.remaining <= 0);

  return { cells, completionDate: lastCompletionDate, completed, changeoverByLine };
}

function orderBySequenceIds(orders: Order[], sequence: string[]): Order[] {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const ranked: Order[] = [];
  for (const id of sequence) {
    const order = byId.get(id);
    if (order) {
      ranked.push(order);
      byId.delete(id);
    }
  }
  // Anything the caller did not rank keeps the default policy order.
  return [...ranked, ...sortOrdersBySequence([...byId.values()])];
}

export function buildSchedule(input: SchedulerInput): SchedulerOutput {
  const {
    orders,
    styles,
    lines,
    learningCurves,
    existingLocks = [],
    lineAssignments,
    lineSplitOverrides,
    sequence,
    sizeMixPolicy = "ratio",
    startDate = format(new Date(), "yyyy-MM-dd"),
    horizonDays = DEFAULT_SCHEDULE_HORIZON_DAYS,
  } = input;

  const physics = resolvePhysics(input.physics);
  const assignments = lineAssignments ?? lineSplitOverrides ?? [];

  const styleMap = new Map(styles.map((s) => [s.id, s]));
  const locksByKey = new Map(
    existingLocks
      .filter((c) => c.locked)
      .map((c) => [`${c.orderId}:${c.stage}:${c.date}:${c.lineId}`, c])
  );

  const sortedOrders = sequence
    ? orderBySequenceIds(orders, sequence)
    : sortOrdersBySequence(orders);

  const cells: ScheduleCell[] = [];
  const lineBusyUntil = new Map<string, string>();
  const lineLastStyle = new Map<string, string>();
  const lineLastColour = new Map<string, ColourState>();
  const lineStyleHistory = new Map<string, StyleRunHistory>();
  const stageCompletion = new Map<string, Record<StageCode, string>>();
  const orderCompletions: Record<string, string> = {};
  const orderStatuses: Record<string, Order["status"]> = {};
  const changeoverByLine: Record<string, number> = {};

  const start = parseDate(startDate);
  const end = addDays(start, horizonDays);

  for (const order of sortedOrders) {
    const style = styleMap.get(order.styleId);
    if (!style) continue;

    const rmDate = parseDate(effectiveRmDate(order, physics.rmBuffer));
    let orderCursor = isBefore(start, rmDate) ? rmDate : start;
    const orderCells: ScheduleCell[] = [];

    // Off, every style runs the full legacy stage list — the four hardcoded
    // stages were this route, just not expressed as one.
    const route = physics.configuredRouting
      ? stagesForRoute(style.routeId)
      : STAGE_ORDER;

    for (const stage of STAGE_ORDER) {
      if (!route.includes(stage)) continue;
      const linesForStage = getLinesForStage(lines, stage);
      if (linesForStage.length === 0) continue;

      // The stage before this one *in the route*, not in the global pipeline —
      // a style that skips knitting must chain cutting's start off nothing,
      // not off knitting's absent completion date.
      const prevStage = route[route.indexOf(stage) - 1];
      if (prevStage) {
        const prevComplete = stageCompletion.get(order.id)?.[prevStage];
        if (prevComplete) {
          const prevDate = parseDate(prevComplete);
          if (isAfter(prevDate, orderCursor)) {
            orderCursor = addDays(prevDate, 1);
          }
        }
      }

      const assignment = getAssignment(assignments, order.id, stage);
      const splitLines = assignment
        ? linesForStage.filter((l) => assignment.lineIds.includes(l.id))
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

      const {
        cells: stageCells,
        completionDate,
        changeoverByLine: stageChangeover,
      } = scheduleMultiLineStage({
        order,
        style,
        styleMap,
        stage,
        linesForStage: activeLines,
        totalRemaining: Math.max(0, order.quantity - alreadyProduced),
        rmDate,
        start: orderCursor,
        end,
        learningCurves,
        locksByKey,
        lineBusyUntil,
        lineLastStyle,
        lineLastColour,
        lineStyleHistory,
        physics,
        sizeMixPolicy,
        assignment,
      });

      orderCells.push(...stageCells);

      for (const [lineId, minutes] of Object.entries(stageChangeover)) {
        changeoverByLine[lineId] = (changeoverByLine[lineId] ?? 0) + minutes;
      }

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

  const totalChangeover = Object.values(changeoverByLine).reduce(
    (sum, m) => sum + m,
    0
  );

  return {
    cells,
    orderCompletions,
    orderStatuses,
    changeoverMinutes: totalChangeover,
    changeoverByLine,
  };
}

export function getMaterialGates(
  orders: Order[],
  cells: ScheduleCell[],
  physics?: Partial<PhysicsOptions>
): MaterialGate[] {
  const resolved = resolvePhysics(physics);

  return orders.map((order) => {
    const firstCell = cells
      .filter((c) => c.orderId === order.id)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const gateDate = effectiveRmDate(order, resolved.rmBuffer);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      rmInHouseDate: order.rmInHouseDate,
      effectiveRmDate: gateDate,
      earliestStart: firstCell?.date ?? gateDate,
      blocked: firstCell ? firstCell.date < gateDate : false,
    };
  });
}
