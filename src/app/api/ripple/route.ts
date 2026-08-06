import { NextRequest, NextResponse } from "next/server";
import { executeRipple, getScheduleSnapshot } from "@/lib/data/repository";
import { STAGE_ORDER, type StageCode } from "@/lib/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Guard against a fat-fingered entry wiping out a plan. */
const MAX_ACTUAL_QTY = 1_000_000;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { orderId, lineId, stage, date, actualQty } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (
    typeof orderId !== "string" ||
    typeof lineId !== "string" ||
    typeof stage !== "string" ||
    typeof date !== "string"
  ) {
    return NextResponse.json(
      { error: "orderId, lineId, stage, and date must be strings" },
      { status: 400 }
    );
  }

  if (!STAGE_ORDER.includes(stage as StageCode)) {
    return NextResponse.json(
      { error: `stage must be one of: ${STAGE_ORDER.join(", ")}` },
      { status: 400 }
    );
  }

  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    return NextResponse.json(
      { error: "date must be a valid YYYY-MM-DD string" },
      { status: 400 }
    );
  }

  const qty = Number(actualQty);
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_ACTUAL_QTY) {
    return NextResponse.json(
      { error: `actualQty must be an integer between 0 and ${MAX_ACTUAL_QTY}` },
      { status: 400 }
    );
  }

  const snapshot = await getScheduleSnapshot();
  if (!snapshot.orders.some((o) => o.id === orderId)) {
    return NextResponse.json({ error: "Unknown orderId" }, { status: 404 });
  }
  if (!snapshot.lines.some((l) => l.id === lineId)) {
    return NextResponse.json({ error: "Unknown lineId" }, { status: 404 });
  }

  const result = await executeRipple({
    orderId,
    lineId,
    stage: stage as StageCode,
    date,
    actualQty: qty,
  });

  return NextResponse.json(result);
}
