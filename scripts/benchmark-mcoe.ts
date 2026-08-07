/**
 * MCOE benchmark.
 *
 * Runs the deterministic fixture through the pre-MCOE path and the optimized
 * path and prints the per-criterion comparison. Doubles as the regression check
 * and as the artifact to show a customer what the engine bought them.
 *
 *   npx tsx scripts/benchmark-mcoe.ts
 */

import { buildAssignments } from "../src/lib/engine/assignment";
import { scorePlan } from "../src/lib/engine/objective";
import { optimizeSchedule } from "../src/lib/engine/optimizer";
import { SIZE_MIX_POLICIES } from "../src/lib/engine/pack-ratio";
import { LEGACY_PHYSICS } from "../src/lib/engine/physics";
import { scoreAllPriorities } from "../src/lib/engine/priority-score";
import { simulateRecoveryOptions } from "../src/lib/engine/recovery";
import { assessRunSizes } from "../src/lib/engine/run-size";
import {
  colourChangeMinutes,
  type ColourState,
} from "../src/lib/engine/changeover";
import { runScenario, type RunScenarioOptions } from "../src/lib/engine/scenario";
import { buildSchedule } from "../src/lib/engine/scheduler";
import { sortOrdersBySequence } from "../src/lib/engine/sequencing-policy";
import {
  ANCHOR_DATE,
  FIXTURE_CURVES,
  FIXTURE_LINES,
  FIXTURE_ORDERS,
  FIXTURE_STYLES,
} from "./fixture";

const HORIZON = 45;

const common = {
  orders: FIXTURE_ORDERS,
  styles: FIXTURE_STYLES,
  lines: FIXTURE_LINES,
  learningCurves: FIXTURE_CURVES,
  startDate: ANCHOR_DATE,
  horizonDays: HORIZON,
};

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

// ---------------------------------------------------------------- baseline
const legacySequence = sortOrdersBySequence(FIXTURE_ORDERS).map((o) => o.id);
const legacyOutput = buildSchedule({
  ...common,
  sequence: legacySequence,
  lineAssignments: buildAssignments("spreadAll", common),
  physics: LEGACY_PHYSICS,
});
const legacyBreakdown = scorePlan({
  orders: FIXTURE_ORDERS,
  lines: FIXTURE_LINES,
  output: legacyOutput,
  startDate: ANCHOR_DATE,
  sequence: legacySequence,
});

// ---------------------------------------------------------------- optimized
const optimized = optimizeSchedule({
  ...common,
  referenceSequence: legacySequence,
});

// The same plan re-measured under the new physics. Comparing the pre-MCOE
// column straight to the optimized one would be unfair: it reports zero
// changeover because changeover was not modelled, not because none happened.
const samePlanNewPhysics = optimized.baseline.breakdown;

heading("Plan quality");
console.log(
  "pre-MCOE and new-physics are the SAME plan; the second column just counts costs the first ignored."
);
const rows: Array<[string, string | number, string | number, string | number]> = [
  ["objective score (lower is better)", legacyBreakdown.score, samePlanNewPhysics.score, optimized.best.breakdown.score],
  ["orders late", legacyBreakdown.lateOrders, samePlanNewPhysics.lateOrders, optimized.best.breakdown.lateOrders],
  ["orders unfinished in horizon", legacyBreakdown.unfinishedOrders, samePlanNewPhysics.unfinishedOrders, optimized.best.breakdown.unfinishedOrders],
  ["total tardiness (days)", legacyBreakdown.rawTardinessDays, samePlanNewPhysics.rawTardinessDays, optimized.best.breakdown.rawTardinessDays],
  ["weighted tardiness (days)", legacyBreakdown.weightedTardinessDays, samePlanNewPhysics.weightedTardinessDays, optimized.best.breakdown.weightedTardinessDays],
  ["changeover (hours)", `${legacyBreakdown.changeoverHours} n/m`, samePlanNewPhysics.changeoverHours, optimized.best.breakdown.changeoverHours],
  ["idle capacity (line-hours)", legacyBreakdown.idleCapacityHours, samePlanNewPhysics.idleCapacityHours, optimized.best.breakdown.idleCapacityHours],
  ["makespan (days)", legacyBreakdown.makespanDays, samePlanNewPhysics.makespanDays, optimized.best.breakdown.makespanDays],
  ["units completed", legacyBreakdown.unitsCompleted, samePlanNewPhysics.unitsCompleted, optimized.best.breakdown.unitsCompleted],
  ["orders moved vs published", legacyBreakdown.churn, samePlanNewPhysics.churn, optimized.best.breakdown.churn],
];

console.log(
  `${"metric".padEnd(36)}${"pre-MCOE".padStart(12)}${"new physics".padStart(14)}${"optimized".padStart(12)}`
);
for (const [label, legacy, physics, best] of rows) {
  console.log(
    `${label.padEnd(36)}${String(legacy).padStart(12)}${String(physics).padStart(14)}${String(best).padStart(12)}`
  );
}
console.log(
  "\nn/m = not modelled before this work. The like-for-like gain is column 2 vs column 3."
);

heading("Pack ratio: what the size draw costs");
console.log(
  "Same sequence and same lines. The only difference is whether sewing draws\n" +
    "sizes in carton ratio or runs one size to exhaustion. Stranded units are\n" +
    "stitched stock that cannot close a carton yet - the WIP on the floor.\n"
);
console.log(
  `${"size draw".padEnd(20)}${"WIP (unit-days)".padStart(18)}${"score".padStart(10)}${"units".padStart(9)}`
);
for (const policy of SIZE_MIX_POLICIES) {
  const output = buildSchedule({
    ...common,
    sequence: optimized.best.sequence,
    lineAssignments: buildAssignments(optimized.best.assignmentStrategy, {
      ...common,
      sequence: optimized.best.sequence,
    }),
    sizeMixPolicy: policy,
  });
  const breakdown = scorePlan({
    orders: FIXTURE_ORDERS,
    lines: FIXTURE_LINES,
    output,
    startDate: ANCHOR_DATE,
    sequence: optimized.best.sequence,
  });
  console.log(
    `${policy.padEnd(20)}${String(breakdown.wipUnitDays).padStart(18)}${String(breakdown.score).padStart(10)}${String(breakdown.unitsCompleted).padStart(9)}`
  );
}
console.log(
  "\nSolid-pack orders are unaffected by design: a solid carton holds one size,\n" +
    "so there is no ratio to honour. The gap is carried by the assorted orders."
);

heading("Colour changeover: what the rethread costs");
console.log(
  "A line is threaded for one colour at a time. Switching costs a rethread and\n" +
    "a first-off check, and going light after dark costs a full cleardown on top.\n"
);
console.log(
  `${"switch".padEnd(24)}${"sewing minutes".padStart(16)}`
);
const colourSwitches: Array<[string, ColourState, ColourState]> = [
  ["black then white", { colour: "Black" }, { colour: "White" }],
  ["white then black", { colour: "White" }, { colour: "Black" }],
  ["navy then charcoal", { colour: "Navy" }, { colour: "Charcoal" }],
  [
    "navy, contrast thread",
    { colour: "Navy" },
    { colour: "Navy", thread: "White" },
  ],
];
for (const [label, from, to] of colourSwitches) {
  console.log(
    `${label.padEnd(24)}${String(colourChangeMinutes(from, to, "sewing")).padStart(16)}`
  );
}

const colourAgnostic = scorePlan({
  orders: FIXTURE_ORDERS,
  lines: FIXTURE_LINES,
  output: buildSchedule({
    ...common,
    sequence: optimized.best.sequence,
    lineAssignments: buildAssignments(optimized.best.assignmentStrategy, {
      ...common,
      sequence: optimized.best.sequence,
    }),
    physics: { colourChangeover: false },
  }),
  startDate: ANCHOR_DATE,
  sequence: optimized.best.sequence,
});
console.log(
  `\n${"".padEnd(24)}${"changeover (h)".padStart(16)}${"units".padStart(9)}${"score".padStart(10)}`
);
console.log(
  `${"colour ignored".padEnd(24)}${String(colourAgnostic.changeoverHours).padStart(16)}${String(colourAgnostic.unitsCompleted).padStart(9)}${String(colourAgnostic.score).padStart(10)}`
);
console.log(
  `${"colour charged".padEnd(24)}${String(optimized.best.breakdown.changeoverHours).padStart(16)}${String(optimized.best.breakdown.unitsCompleted).padStart(9)}${String(optimized.best.breakdown.score).padStart(10)}`
);
console.log(
  "\nThe first row is the plan the factory would publish if colour were free.\n" +
    "The second is what the same plan actually delivers once rethreads are paid."
);

heading("Configured routing: what a route skips");
console.log(
  "The Basic Tee is cut from bought fabric, not knit in-house, so its route is\n" +
    "cut-to-pack: cutting, sewing, packing. Every other style here is knit-to-pack\n" +
    "and adds knitting first. Same order, same lines - only the route differs.\n"
);
const teeStyleIndex = FIXTURE_STYLES.findIndex((s) => s.id === "style-tee-03");
const asKnitToPack = FIXTURE_STYLES.map((s, i) =>
  i === teeStyleIndex ? { ...s, routeId: "knit-to-pack" } : s
);
const cutToPackOutput = buildSchedule({ ...common, sequence: legacySequence });
const knitToPackOutput = buildSchedule({
  ...common,
  sequence: legacySequence,
  styles: asKnitToPack,
});
console.log(
  `${"route".padEnd(16)}${"ord-001 completes".padStart(20)}${"ord-005 completes".padStart(20)}${"knit-line days worked".padStart(24)}`
);
for (const [label, output] of [
  ["cut-to-pack", cutToPackOutput],
  ["knit-to-pack", knitToPackOutput],
] as const) {
  const knitDaysWorked = new Set(
    output.cells.filter((c) => c.stage === "knitting").map((c) => c.date)
  ).size;
  console.log(
    `${label.padEnd(16)}${String(output.orderCompletions["ord-001"]).padStart(20)}${String(output.orderCompletions["ord-005"]).padStart(20)}${String(knitDaysWorked).padStart(24)}`
  );
}
console.log(
  "\nForcing the tee onto knit-to-pack does not change its cutting or sewing\n" +
    "rate - it only gives the knitting line more days of work, because it is now\n" +
    "asked to run an operation the fabric this style actually receives never needs."
);

heading("Search");
console.log(`winning strategy   ${optimized.best.sequenceStrategy} + ${optimized.best.assignmentStrategy}`);
console.log(`plans evaluated    ${optimized.evaluated}`);
console.log(`wall clock         ${optimized.elapsedMs} ms`);
console.log(`objective gain     ${optimized.improvement}`);
console.log(`winning sequence   ${optimized.best.sequence.join(" > ")}`);

heading("Runners-up (the trade the optimizer rejected)");
for (const candidate of optimized.runnersUp) {
  const b = candidate.breakdown;
  console.log(
    `${`${candidate.sequenceStrategy}+${candidate.assignmentStrategy}`.padEnd(34)} score ${String(b.score).padStart(8)}  late ${b.lateOrders}  changeover ${b.changeoverHours}h`
  );
}

heading("Critical ratio and priority buckets");
console.log(
  "CR assumes an order has the stage's whole line pool to itself, so it reads\n" +
    "optimistically when orders queue behind each other. It is a candidate-generation\n" +
    "input, not a delivery promise - the simulated completion dates above are.\n"
);
const priorities = scoreAllPriorities({
  orders: FIXTURE_ORDERS,
  styles: FIXTURE_STYLES,
  lines: FIXTURE_LINES,
  today: ANCHOR_DATE,
});
for (const p of priorities) {
  const order = FIXTURE_ORDERS.find((o) => o.id === p.orderId)!;
  console.log(
    `${order.orderNumber.padEnd(14)} CR ${String(p.criticalRatio).padStart(7)}  lead ${String(p.remainingLeadDays).padStart(6)}d  slack ${String(p.slackDays).padStart(7)}d  ${p.bucket.padEnd(16)} rmReady=${p.rmReady}`
  );
}

heading("Run-size viability (sewing)");
const runSizes = assessRunSizes({
  orders: FIXTURE_ORDERS,
  styles: FIXTURE_STYLES,
  lines: FIXTURE_LINES,
  learningCurves: FIXTURE_CURVES,
});
for (const r of runSizes) {
  const flag = r.subScale ? "SUB-SCALE" : "ok";
  console.log(
    `${r.orderNumber.padEnd(14)} qty ${String(r.quantity).padStart(6)}  ramp needs ${String(r.unitsToReachThreshold).padStart(5)} units  rampShare ${String(r.rampShare).padStart(6)}  ${flag}`
  );
  if (r.recommendation) console.log(`               ${r.recommendation}`);
}

heading("What-if: hoodie fabric slips 3 days (capacity-bound order)");
const absorbed = runScenario(common, {
  name: "hoodie-fabric-delay",
  mutations: [{ type: "shiftRmDate", orderId: "ord-003", days: 3 }],
});
reportScenario(absorbed);
console.log(
  "  Absorbed: this order was queueing behind capacity, not waiting on fabric."
);

heading("What-if: jogger fabric slips 3 days (material-bound order)");
const propagated = runScenario(common, {
  name: "jogger-fabric-delay",
  mutations: [{ type: "shiftRmDate", orderId: "ord-004", days: 3 }],
});
reportScenario(propagated);

heading("What-if: same jogger delay, but allowed to resequence");
const recovered = runScenario(common, {
  name: "jogger-fabric-delay-reoptimized",
  mutations: [{ type: "shiftRmDate", orderId: "ord-004", days: 3 }],
  reoptimize: true,
});
console.log(`score vs published plan  ${recovered.diff.scoreDelta}`);
console.log(`late orders delta        ${recovered.diff.lateOrdersDelta}`);
console.log(`resequenced to           ${recovered.sequence.join(" > ")}`);

heading("What-if: the customer recolours a run mid-plan");
const recoloured = runScenario(common, {
  name: "tee-white-to-black",
  mutations: [
    { type: "changeColour", orderId: "ord-002", from: "White", to: "Black" },
  ],
});
reportScenario(recoloured);
console.log(
  "  The order is unchanged in quantity, style and deadline. Only the shade moved,\n" +
    "  and with it the cleardown the line no longer has to do."
);

heading("What-if: quantity split mid-run, and the split part recoloured");
const splitMutations: RunScenarioOptions["mutations"] = [
  {
    type: "splitOrder",
    orderId: "ord-004",
    quantity: 1200,
    newOrderId: "ord-004b",
    deadlineShiftDays: 7,
  },
  { type: "changeColour", orderId: "ord-004b", from: "Black", to: "Sand" },
];
const splitAndRecoloured = runScenario(common, {
  name: "jogger-split-and-recolour",
  mutations: splitMutations,
});
reportScenario(splitAndRecoloured);
console.log(`  sequence  ${splitAndRecoloured.sequence.join(" > ")}`);
console.log(
  "  Both halves keep the full size curve, so each can still close cartons, and\n" +
    "  the later-shipping half is sequenced by the same rules as any other order.\n" +
    "  The trade shows rather than hides: taking 1,200 units out pulls the first\n" +
    "  shipment in four days and lifts everything behind it, but the tail is now a\n" +
    "  short run of its own and misses its later date. Splitting buys the near\n" +
    "  deadline at the cost of the far one."
);

function reportScenario(result: ReturnType<typeof runScenario>): void {
  console.log(`score delta        ${result.diff.scoreDelta}`);
  console.log(`late orders delta  ${result.diff.lateOrdersDelta}`);
  console.log(`makespan delta     ${result.diff.makespanDaysDelta} days`);
  const shifts = result.diff.completionShifts.filter(
    (s) => s.deltaDays || !s.baseline
  );
  if (shifts.length === 0) {
    console.log("no completion dates moved");
    return;
  }
  for (const shift of shifts) {
    if (!shift.baseline) {
      console.log(`  ${shift.orderId}  new, completes ${shift.scenario}`);
      continue;
    }
    console.log(
      `  ${shift.orderId}  ${shift.baseline} -> ${shift.scenario}  (${shift.deltaDays! > 0 ? "+" : ""}${shift.deltaDays} days)`
    );
  }
}

heading("Simulated recovery options for the most-delayed order");
const worst = [...FIXTURE_ORDERS].sort((a, b) => {
  const ca = optimized.best.output.orderCompletions[a.id] ?? "";
  const cb = optimized.best.output.orderCompletions[b.id] ?? "";
  const la = ca > a.deliveryDeadline ? 1 : 0;
  const lb = cb > b.deliveryDeadline ? 1 : 0;
  return lb - la;
})[0]!;
const recovery = simulateRecoveryOptions({
  orderId: worst.id,
  ...common,
});
console.log(`target             ${worst.orderNumber} (baseline completion ${recovery.baselineCompletion})`);
if (recovery.options.length === 0) {
  console.log("no simulated option improved this order");
}
for (const option of recovery.options) {
  console.log(
    `${option.isRecommended ? "*" : " "} ${option.title.padEnd(48)} pulls in ${String(option.impactDays).padStart(3)}d  cost ${option.costIndex}  confidence ${option.confidence}`
  );
}

console.log("");
