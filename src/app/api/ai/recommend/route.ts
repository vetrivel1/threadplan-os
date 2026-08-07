import { NextRequest, NextResponse } from "next/server";
import { differenceInDays, parseISO } from "date-fns";
import { getScheduleSnapshot } from "@/lib/data/repository";
import { generateAIRecommendations } from "@/lib/ai/copilot";
import { simulateRecoveryOptions } from "@/lib/engine/recovery";
import { REPLAN_HORIZON_DAYS } from "@/lib/engine/sequencing-policy";
import type { RecoveryOption } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // A previous request's abort (React StrictMode double-invoke in dev, or a
    // planner navigating away mid-fetch) can occasionally corrupt a reused
    // keep-alive connection and hand us an empty body here. Fail cleanly
    // rather than crashing the route — the client will just retry.
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  if (typeof raw.orderId !== "string") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  const orderId = raw.orderId;
  const daysLate = typeof raw.daysLate === "number" ? raw.daysLate : undefined;
  const projectedCompletion =
    typeof raw.projectedCompletion === "string"
      ? raw.projectedCompletion
      : undefined;
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w): w is string => typeof w === "string")
    : [];

  const snapshot = await getScheduleSnapshot();
  const order = snapshot.orders.find((o) => o.id === orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const style = snapshot.styles.find((s) => s.id === order.styleId);
  if (!style) {
    return NextResponse.json({ error: "Style not found" }, { status: 404 });
  }

  const computedLate =
    projectedCompletion && order.deliveryDeadline
      ? Math.max(
          0,
          differenceInDays(
            parseISO(projectedCompletion),
            parseISO(order.deliveryDeadline)
          )
        )
      : daysLate ?? 0;

  // Measure each recovery option against the scheduler first, so the model is
  // narrating real outcomes rather than estimating them.
  let simulatedOptions: RecoveryOption[] | undefined;
  try {
    simulatedOptions = simulateRecoveryOptions({
      orderId: order.id,
      orders: snapshot.orders,
      styles: snapshot.styles,
      lines: snapshot.lines,
      learningCurves: snapshot.learningCurves,
      existingLocks: snapshot.cells.filter((c) => c.locked),
      horizonDays: REPLAN_HORIZON_DAYS,
    }).options;
  } catch {
    // Fall back to the unsimulated path rather than failing the request.
    simulatedOptions = undefined;
  }

  const { summary, options } = await generateAIRecommendations({
    order,
    style,
    daysLate: computedLate,
    projectedCompletion: projectedCompletion ?? "",
    affectedOrders: snapshot.orders.map((o) => o.orderNumber),
    warnings,
    simulatedOptions,
  });

  return NextResponse.json({
    orderId,
    orderNumber: order.orderNumber,
    daysLate: computedLate,
    summary,
    options,
    grounded: Boolean(simulatedOptions?.length),
    generatedAt: new Date().toISOString(),
  });
}
