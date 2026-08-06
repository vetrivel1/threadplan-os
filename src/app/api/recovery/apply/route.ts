import { NextRequest, NextResponse } from "next/server";
import { applyLineSplitRecovery, getScheduleSnapshot } from "@/lib/data/repository";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { orderId, optionId } = (body ?? {}) as Record<string, unknown>;

  if (typeof orderId !== "string" || typeof optionId !== "string") {
    return NextResponse.json(
      { error: "orderId and optionId are required" },
      { status: 400 }
    );
  }

  const snapshot = await getScheduleSnapshot();

  // A full reschedule is triggered below — never run it for an unknown order
  if (!snapshot.orders.some((o) => o.id === orderId)) {
    return NextResponse.json({ error: "Unknown orderId" }, { status: 404 });
  }

  if (optionId === "split-line" || optionId.startsWith("split")) {
    const sewingLines = snapshot.lines
      .filter((l) => l.stage === "sewing")
      .map((l) => l.id);

    if (sewingLines.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 sewing lines for split" },
        { status: 400 }
      );
    }

    const result = await applyLineSplitRecovery(orderId, sewingLines, [0.55, 0.45]);
    return NextResponse.json(result);
  }

  return NextResponse.json(
    { error: `Recovery option '${optionId}' not yet implemented server-side` },
    { status: 501 }
  );
}
