import { NextRequest, NextResponse } from "next/server";
import { executeBulkRipple, getScheduleSnapshot } from "@/lib/data/repository";
import { STAGE_ORDER, type RippleEdit, type StageCode } from "@/lib/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Guard against a fat-fingered entry wiping out a plan. */
const MAX_ACTUAL_QTY = 1_000_000;
/** Guard against an unbounded payload — a real floor has dozens of lines, not thousands. */
const MAX_EDITS = 500;

function parseEdit(raw: unknown, index: number): RippleEdit | { error: string } {
  const { orderId, lineId, stage, date, actualQty } = (raw ?? {}) as Record<
    string,
    unknown
  >;

  if (
    typeof orderId !== "string" ||
    typeof lineId !== "string" ||
    typeof stage !== "string" ||
    typeof date !== "string"
  ) {
    return { error: `edits[${index}]: orderId, lineId, stage, and date must be strings` };
  }
  if (!STAGE_ORDER.includes(stage as StageCode)) {
    return { error: `edits[${index}]: stage must be one of: ${STAGE_ORDER.join(", ")}` };
  }
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: `edits[${index}]: date must be a valid YYYY-MM-DD string` };
  }
  const qty = Number(actualQty);
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_ACTUAL_QTY) {
    return {
      error: `edits[${index}]: actualQty must be an integer between 0 and ${MAX_ACTUAL_QTY}`,
    };
  }

  return { orderId, lineId, stage: stage as StageCode, date, actualQty: qty };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { edits: rawEdits } = (body ?? {}) as Record<string, unknown>;

  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    return NextResponse.json(
      { error: "edits must be a non-empty array" },
      { status: 400 }
    );
  }
  if (rawEdits.length > MAX_EDITS) {
    return NextResponse.json(
      { error: `edits must contain at most ${MAX_EDITS} entries` },
      { status: 400 }
    );
  }

  const edits: RippleEdit[] = [];
  for (let i = 0; i < rawEdits.length; i++) {
    const parsed = parseEdit(rawEdits[i], i);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    edits.push(parsed);
  }

  const snapshot = await getScheduleSnapshot();
  for (const edit of edits) {
    if (!snapshot.orders.some((o) => o.id === edit.orderId)) {
      return NextResponse.json(
        { error: `Unknown orderId: ${edit.orderId}` },
        { status: 404 }
      );
    }
    if (!snapshot.lines.some((l) => l.id === edit.lineId)) {
      return NextResponse.json(
        { error: `Unknown lineId: ${edit.lineId}` },
        { status: 404 }
      );
    }
  }

  const result = await executeBulkRipple({ edits });

  return NextResponse.json(result);
}
