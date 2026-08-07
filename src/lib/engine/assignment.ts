import type { Order, ProductionLine, StageCode, Style } from "../types";
import { STAGE_ORDER, stagesForRoute } from "../types";
import { estimateLineMinutes } from "./capacity";
import { changeoverMinutes } from "./changeover";
import type { LineAssignment } from "./scheduler";
import { sortOrdersBySequence } from "./sequencing-policy";

/**
 * How an order's volume is distributed across the lines of a stage.
 *
 * `spreadAll` is the historical behaviour: every order occupies every line in
 * the stage, which finishes each order quickly but serialises the factory and
 * forces a changeover on every line at every order boundary. The other two
 * strategies pin an order to a single line, which is what allows two orders to
 * run concurrently and what makes changeover something worth optimising.
 */
export type AssignmentStrategy = "spreadAll" | "dedicate" | "balanced";

export const ASSIGNMENT_STRATEGIES: AssignmentStrategy[] = [
  "spreadAll",
  "dedicate",
  "balanced",
];

/**
 * Relative importance of avoiding a changeover when picking a line.
 * `dedicate` weights it heavily, so runs of the same style cluster onto one
 * line; `balanced` mostly chases the earliest free line.
 */
const SETUP_WEIGHT: Record<Exclude<AssignmentStrategy, "spreadAll">, number> = {
  dedicate: 8,
  balanced: 1,
};

export interface AssignmentInput {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  /** Order ids in the sequence the scheduler will process them. */
  sequence?: string[];
}

export function buildAssignments(
  strategy: AssignmentStrategy,
  input: AssignmentInput
): LineAssignment[] {
  if (strategy === "spreadAll") return [];

  const { orders, styles, lines } = input;
  const styleMap = new Map(styles.map((s) => [s.id, s]));
  const ordered = orderInSequence(orders, input.sequence);
  const setupWeight = SETUP_WEIGHT[strategy];

  // Running load per line, in line-minutes, plus what it last ran so the
  // changeover estimate reflects the sequence being built.
  const lineLoad = new Map<string, number>();
  const lineLastStyle = new Map<string, string>();
  const assignments: LineAssignment[] = [];

  for (const order of ordered) {
    const style = styleMap.get(order.styleId);
    if (!style) continue;

    const route = stagesForRoute(style.routeId);

    for (const stage of STAGE_ORDER) {
      // An order never visits a stage its style's route does not name, so
      // there is nothing to assign it to here.
      if (!route.includes(stage)) continue;

      const stageLines = lines.filter((l) => l.stage === stage);
      // With one line there is no decision to make; leaving it unassigned keeps
      // the scheduler on its default path.
      if (stageLines.length <= 1) continue;

      const best = pickLine({
        stageLines,
        order,
        style,
        stage,
        styleMap,
        lineLoad,
        lineLastStyle,
        setupWeight,
      });
      if (!best) continue;

      assignments.push({
        orderId: order.id,
        stage,
        lineIds: [best.line.id],
        ratios: [1],
      });

      lineLoad.set(best.line.id, (lineLoad.get(best.line.id) ?? 0) + best.cost);
      lineLastStyle.set(best.line.id, style.id);
    }
  }

  return assignments;
}

function pickLine(params: {
  stageLines: ProductionLine[];
  order: Order;
  style: Style;
  stage: StageCode;
  styleMap: Map<string, Style>;
  lineLoad: Map<string, number>;
  lineLastStyle: Map<string, string>;
  setupWeight: number;
}): { line: ProductionLine; cost: number } | undefined {
  const {
    stageLines,
    order,
    style,
    stage,
    styleMap,
    lineLoad,
    lineLastStyle,
    setupWeight,
  } = params;

  let best: { line: ProductionLine; cost: number; score: number } | undefined;

  for (const line of stageLines) {
    const workMinutes = estimateLineMinutes(
      order.quantity,
      style.smv[stage],
      line.operators,
      line.efficiencyBaseline,
      order.packingType,
      stage
    );

    const previousStyleId = lineLastStyle.get(line.id);
    const previousStyle = previousStyleId
      ? styleMap.get(previousStyleId)
      : undefined;
    const setup = changeoverMinutes(previousStyle, style, stage);

    const cost = workMinutes + setup;
    const score = (lineLoad.get(line.id) ?? 0) + workMinutes + setup * setupWeight;

    if (!best || score < best.score) {
      best = { line, cost, score };
    }
  }

  if (!best) return undefined;
  return { line: best.line, cost: best.cost };
}

function orderInSequence(orders: Order[], sequence?: string[]): Order[] {
  if (!sequence) return sortOrdersBySequence(orders);

  const byId = new Map(orders.map((o) => [o.id, o]));
  const ranked: Order[] = [];
  for (const id of sequence) {
    const order = byId.get(id);
    if (order) {
      ranked.push(order);
      byId.delete(id);
    }
  }
  return [...ranked, ...sortOrdersBySequence([...byId.values()])];
}
