import { NextRequest, NextResponse } from "next/server";
import {
  generateBatchBriefing,
  type BatchOrderImpact,
} from "@/lib/ai/briefing";

function isValidImpact(v: unknown): v is BatchOrderImpact {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.orderNumber === "string" &&
    typeof r.styleCode === "string" &&
    typeof r.projectedCompletion === "string" &&
    typeof r.deliveryDeadline === "string" &&
    typeof r.daysLate === "number"
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Same class of drop as /api/ai/recommend — fail clean, never crash.
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  const briefing = await generateBatchBriefing({
    editsCount: typeof raw.editsCount === "number" ? raw.editsCount : 0,
    linesReported: typeof raw.linesReported === "number" ? raw.linesReported : 0,
    totalVarianceUnits:
      typeof raw.totalVarianceUnits === "number" ? raw.totalVarianceUnits : 0,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((w): w is string => typeof w === "string")
      : [],
    atRisk: Array.isArray(raw.atRisk) ? raw.atRisk.filter(isValidImpact) : [],
    onTrackCount: typeof raw.onTrackCount === "number" ? raw.onTrackCount : 0,
  });

  return NextResponse.json(briefing);
}
