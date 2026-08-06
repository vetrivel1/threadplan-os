import { NextRequest, NextResponse } from "next/server";
import { applyRecoveryOption } from "@/lib/data/repository";

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

  const outcome = await applyRecoveryOption(orderId, optionId);

  if (!outcome.ok) {
    return outcome.reason === "unknown-order"
      ? NextResponse.json({ error: "Unknown orderId" }, { status: 404 })
      : NextResponse.json(
          { error: `'${optionId}' is not a recovery option for this order` },
          { status: 400 }
        );
  }

  return NextResponse.json(outcome.result);
}
