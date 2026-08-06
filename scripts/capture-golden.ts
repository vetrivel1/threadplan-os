/**
 * Captures the scheduler's output on the deterministic fixture into
 * scripts/golden-baseline.json.
 *
 * Run this only from a known-good commit. The Phase 2 parity gate replays the
 * legacy physics path against this file to prove the optimizer wrapper did not
 * change the underlying schedule.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSchedule } from "../src/lib/engine/scheduler";
import {
  ANCHOR_DATE,
  FIXTURE_CURVES,
  FIXTURE_LINES,
  FIXTURE_ORDERS,
  FIXTURE_STYLES,
} from "./fixture";

const result = buildSchedule({
  orders: FIXTURE_ORDERS,
  styles: FIXTURE_STYLES,
  lines: FIXTURE_LINES,
  learningCurves: FIXTURE_CURVES,
  startDate: ANCHOR_DATE,
  horizonDays: 45,
});

const outPath = join(process.cwd(), "scripts", "golden-baseline.json");
writeFileSync(
  outPath,
  JSON.stringify(
    {
      anchorDate: ANCHOR_DATE,
      cells: result.cells,
      orderCompletions: result.orderCompletions,
      orderStatuses: result.orderStatuses,
    },
    null,
    2
  )
);

console.log(`Captured ${result.cells.length} cells to ${outPath}`);
console.log("Completions:", result.orderCompletions);
