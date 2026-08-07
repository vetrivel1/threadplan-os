import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Order, ScheduleCell, StageCode, Style } from "../types";
import { stagesForRoute } from "../types";
import { effectiveRmDate } from "./material-gate";

/**
 * Critical path per order.
 *
 * This engine's routes are strictly sequential — knitting then cutting then
 * sewing then packing, never two stages racing in parallel — so the classic
 * multiple-paths-compared CPM question does not apply directly. What still
 * varies is *slack*: whether a stage started the moment it possibly could
 * (material ready, predecessor done) or sat queued behind a busy line. A
 * stage with zero slack is genuinely gating the finish date; a stage with
 * slack could run later without moving anything, because something else
 * already determines when the order finishes.
 */

export interface StageTiming {
  stage: StageCode;
  /** Material readiness or predecessor completion + 1 day, whichever binds. */
  earliestPossibleStart: string;
  /** Where this stage actually started, from the plan. */
  actualStart: string;
  actualCompletion: string;
  /** Days this stage sat queued before starting, beyond what physics required. */
  queueDelayDays: number;
  onCriticalPath: boolean;
}

export interface OrderCriticalPath {
  orderId: string;
  route: StageCode[];
  stages: StageTiming[];
  completion: string | null;
  /**
   * The trailing run of stages, back from completion, that actually determine
   * the finish date. Speeding up anything before this chain would not pull
   * the order in; speeding up anything inside it would.
   */
  criticalChain: StageCode[];
  totalQueueDelayDays: number;
}

export interface ComputeCriticalPathsInput {
  orders: Order[];
  styles: Style[];
  cells: ScheduleCell[];
  /** Matches `physics.rmBuffer` — whether the RM buffer day is in effect. */
  rmBuffer?: boolean;
}

export function computeCriticalPaths(
  input: ComputeCriticalPathsInput
): OrderCriticalPath[] {
  const { orders, styles, cells, rmBuffer = true } = input;
  const styleMap = new Map(styles.map((s) => [s.id, s]));

  const bounds = new Map<string, { start: string; end: string }>();
  for (const cell of cells) {
    const key = `${cell.orderId}::${cell.stage}`;
    const existing = bounds.get(key);
    if (!existing) {
      bounds.set(key, { start: cell.date, end: cell.date });
    } else {
      if (cell.date < existing.start) existing.start = cell.date;
      if (cell.date > existing.end) existing.end = cell.date;
    }
  }

  const results: OrderCriticalPath[] = [];

  for (const order of orders) {
    const style = styleMap.get(order.styleId);
    if (!style) continue;

    const route = stagesForRoute(style.routeId);
    const rmDate = effectiveRmDate(order, rmBuffer);

    const stages: StageTiming[] = [];
    let predecessorCompletion: string | null = null;

    for (const stage of route) {
      const bound = bounds.get(`${order.id}::${stage}`);
      if (!bound) continue;

      const earliestPossibleStart = predecessorCompletion
        ? addDaysStr(predecessorCompletion, 1)
        : rmDate;
      const queueDelayDays = Math.max(
        0,
        differenceInCalendarDays(
          parseISO(bound.start),
          parseISO(earliestPossibleStart)
        )
      );

      stages.push({
        stage,
        earliestPossibleStart,
        actualStart: bound.start,
        actualCompletion: bound.end,
        queueDelayDays,
        onCriticalPath: queueDelayDays === 0,
      });

      predecessorCompletion = bound.end;
    }

    const criticalChain: StageCode[] = [];
    for (let i = stages.length - 1; i >= 0; i--) {
      criticalChain.unshift(stages[i]!.stage);
      if (stages[i]!.queueDelayDays > 0) break;
    }

    results.push({
      orderId: order.id,
      route,
      stages,
      completion: stages.length > 0 ? stages[stages.length - 1]!.actualCompletion : null,
      criticalChain,
      totalQueueDelayDays: stages.reduce((sum, s) => sum + s.queueDelayDays, 0),
    });
  }

  return results;
}

function addDaysStr(dateStr: string, days: number): string {
  return format(addDays(parseISO(dateStr), days), "yyyy-MM-dd");
}
