import { NextResponse } from "next/server";
import { getScheduleSnapshot } from "@/lib/data/repository";

export async function GET() {
  const snapshot = await getScheduleSnapshot();
  return NextResponse.json({
    ...snapshot,
    source: snapshot.source,
  });
}
