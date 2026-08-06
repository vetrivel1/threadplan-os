/**
 * Parity gate.
 *
 * Replays the deterministic fixture through the scheduler with LEGACY_PHYSICS
 * and the default spread-across-all-lines assignment, and asserts the result is
 * byte-identical to the golden baseline captured before the MCOE work. This is
 * what proves the optimizer wrapper and the physics flags did not silently
 * change the underlying schedule.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSchedule } from "../src/lib/engine/scheduler";
import { buildAssignments } from "../src/lib/engine/assignment";
import { LEGACY_PHYSICS } from "../src/lib/engine/physics";
import {
  ANCHOR_DATE,
  FIXTURE_CURVES,
  FIXTURE_LINES,
  FIXTURE_ORDERS,
  FIXTURE_STYLES,
} from "./fixture";

const goldenPath = join(process.cwd(), "scripts", "golden-baseline.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as {
  anchorDate: string;
  cells: unknown[];
  orderCompletions: Record<string, string>;
  orderStatuses: Record<string, string>;
};

// spreadAll must round-trip to an empty assignment list, so the scheduler stays
// on its original code path.
const spreadAll = buildAssignments("spreadAll", {
  orders: FIXTURE_ORDERS,
  styles: FIXTURE_STYLES,
  lines: FIXTURE_LINES,
});

const result = buildSchedule({
  orders: FIXTURE_ORDERS,
  styles: FIXTURE_STYLES,
  lines: FIXTURE_LINES,
  learningCurves: FIXTURE_CURVES,
  lineAssignments: spreadAll,
  startDate: ANCHOR_DATE,
  horizonDays: 45,
  physics: LEGACY_PHYSICS,
});

const failures: string[] = [];

if (spreadAll.length !== 0) {
  failures.push(
    `spreadAll should produce no assignments, got ${spreadAll.length}`
  );
}

if (golden.anchorDate !== ANCHOR_DATE) {
  failures.push(
    `Anchor drift: golden ${golden.anchorDate} vs fixture ${ANCHOR_DATE}`
  );
}

const actualCells = JSON.stringify(result.cells);
const goldenCells = JSON.stringify(golden.cells);
if (actualCells !== goldenCells) {
  failures.push(
    `Cell mismatch: ${result.cells.length} cells now vs ${golden.cells.length} in golden`
  );

  const goldenList = golden.cells as Record<string, unknown>[];
  let shown = 0;
  for (let i = 0; i < Math.max(goldenList.length, result.cells.length); i++) {
    const a = JSON.stringify(goldenList[i] ?? null);
    const b = JSON.stringify(result.cells[i] ?? null);
    if (a !== b && shown < 3) {
      failures.push(`  [${i}] golden: ${a}`);
      failures.push(`  [${i}] actual: ${b}`);
      shown++;
    }
  }
}

for (const [orderId, date] of Object.entries(golden.orderCompletions)) {
  if (result.orderCompletions[orderId] !== date) {
    failures.push(
      `Completion drift for ${orderId}: golden ${date} vs actual ${result.orderCompletions[orderId]}`
    );
  }
}

for (const [orderId, status] of Object.entries(golden.orderStatuses)) {
  if (result.orderStatuses[orderId] !== status) {
    failures.push(
      `Status drift for ${orderId}: golden ${status} vs actual ${result.orderStatuses[orderId]}`
    );
  }
}

if (result.changeoverMinutes !== 0) {
  failures.push(
    `Legacy physics should incur no changeover, got ${result.changeoverMinutes} minutes`
  );
}

if (failures.length > 0) {
  console.error("PARITY FAILED");
  for (const f of failures) console.error(f);
  process.exit(1);
}

console.log(
  `PARITY OK - ${result.cells.length} cells identical to golden baseline`
);
