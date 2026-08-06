import { NextRequest, NextResponse } from "next/server";
import { differenceInDays, parseISO } from "date-fns";
import { getScheduleSnapshot } from "@/lib/data/repository";
import { generateAIRecommendations } from "@/lib/ai/copilot";
import { simulateRecoveryOptions } from "@/lib/engine/recovery";
import { REPLAN_HORIZON_DAYS } from "@/lib/engine/sequencing-policy";
import type { RecoveryOption } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orderId, daysLate, projectedCompletion, warnings = [] } = body;

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
