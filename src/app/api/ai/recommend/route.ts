import { NextRequest, NextResponse } from "next/server";
import { differenceInDays, parseISO } from "date-fns";
import { getScheduleSnapshot } from "@/lib/data/repository";
import { generateAIRecommendations } from "@/lib/ai/copilot";

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

  const { summary, options } = await generateAIRecommendations({
    order,
    style,
    daysLate: computedLate,
    projectedCompletion: projectedCompletion ?? "",
    affectedOrders: snapshot.orders.map((o) => o.orderNumber),
    warnings,
  });

  return NextResponse.json({
    orderId,
    orderNumber: order.orderNumber,
    daysLate: computedLate,
    summary,
    options,
    generatedAt: new Date().toISOString(),
  });
}
