import type {
  Order,
  Organization,
  RippleResult,
  ScheduleCell,
  ScheduleSnapshot,
  StageCode,
} from "@/lib/types";
import {
  DEMO_LEARNING_CURVES,
  DEMO_LINES,
  DEMO_ORDERS,
  DEMO_ORG,
  DEMO_STYLES,
  buildInitialSchedule,
} from "@/lib/seed/demo-data";
import { buildSchedule, getMaterialGates } from "@/lib/engine/scheduler";
import { applyRipple } from "@/lib/engine/ripple";
import {
  REPLAN_HORIZON_DAYS,
  SEQUENCE_HORIZON_DAYS,
  deriveOrderStatus,
} from "@/lib/engine/sequencing-policy";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  buildLearningCurves,
  mapCell,
  mapCellToDb,
  mapLine,
  mapOrder,
  mapStyle,
  type DbCell,
  type DbLearningCurve,
  type DbLine,
  type DbOrder,
  type DbStyle,
} from "./mappers";

export function getDemoSnapshot(): ScheduleSnapshot {
  const cells = buildInitialSchedule();
  return {
    orders: DEMO_ORDERS,
    styles: DEMO_STYLES,
    lines: DEMO_LINES,
    cells,
    materialGates: getMaterialGates(DEMO_ORDERS, cells),
    learningCurves: DEMO_LEARNING_CURVES,
  };
}

export async function getOrganizationId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return DEMO_ORG.id;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return DEMO_ORG.id;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  return profile?.organization_id ?? null;
}

export async function getScheduleSnapshot(): Promise<ScheduleSnapshot & { organization: Organization; source: "supabase" | "demo" }> {
  if (!isSupabaseConfigured()) {
    return { ...getDemoSnapshot(), organization: DEMO_ORG, source: "demo" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ...getDemoSnapshot(), organization: DEMO_ORG, source: "demo" };
  }

  const orgId = await getOrganizationId();
  if (!orgId) {
    return { ...getDemoSnapshot(), organization: DEMO_ORG, source: "demo" };
  }

  const [orgRes, linesRes, stylesRes, ordersRes, cellsRes, curvesRes] =
    await Promise.all([
      supabase.from("organizations").select("*").eq("id", orgId).single(),
      supabase.from("production_lines").select("*").eq("organization_id", orgId),
      supabase.from("styles").select("*").eq("organization_id", orgId),
      supabase.from("orders").select("*").eq("organization_id", orgId),
      supabase.from("schedule_cells").select("*").eq("organization_id", orgId),
      supabase
        .from("learning_curves")
        .select("style_id, day_number, efficiency")
        .in(
          "style_id",
          (
            await supabase
              .from("styles")
              .select("id")
              .eq("organization_id", orgId)
          ).data?.map((s) => s.id) ?? []
        ),
    ]);

  const lines = (linesRes.data as DbLine[] | null)?.map(mapLine) ?? [];
  const styles = (stylesRes.data as DbStyle[] | null)?.map(mapStyle) ?? [];
  const orders = (ordersRes.data as DbOrder[] | null)?.map(mapOrder) ?? [];
  let cells = (cellsRes.data as DbCell[] | null)?.map(mapCell) ?? [];
  const learningCurves = buildLearningCurves(
    (curvesRes.data as DbLearningCurve[] | null) ?? []
  );

  if (cells.length === 0 && orders.length > 0) {
    const result = buildSchedule({
      orders,
      styles,
      lines,
      learningCurves,
      horizonDays: SEQUENCE_HORIZON_DAYS,
    });
    cells = result.cells;
    await persistCells(orgId, cells, result.orderStatuses);
  }

  const org = orgRes.data
    ? { id: orgRes.data.id, name: orgRes.data.name, slug: orgRes.data.slug }
    : DEMO_ORG;

  return {
    orders,
    styles,
    lines,
    cells,
    materialGates: getMaterialGates(orders, cells),
    learningCurves,
    organization: org,
    source: "supabase",
  };
}

export async function persistCells(
  orgId: string,
  cells: ScheduleCell[],
  orderStatuses?: Record<string, Order["status"]>
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return;

  const rows = cells.map((c) => mapCellToDb(c, orgId));

  const { error } = await supabase.from("schedule_cells").upsert(
    rows.map((r) => ({
      ...r,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "order_id,stage,schedule_date,line_id" }
  );

  if (error) throw new Error(error.message);

  if (orderStatuses) {
    for (const [orderId, status] of Object.entries(orderStatuses)) {
      await supabase
        .from("orders")
        .update({ status })
        .eq("id", orderId)
        .eq("organization_id", orgId);
    }
  }
}

export interface RippleParams {
  orderId: string;
  lineId: string;
  stage: StageCode;
  date: string;
  actualQty: number;
  lineSplitOverrides?: import("@/lib/engine/scheduler").LineSplitOverride[];
}

export async function executeRipple(
  params: RippleParams
): Promise<RippleResult & { snapshot: ScheduleSnapshot }> {
  const snapshot = await getScheduleSnapshot();
  const { orders, styles, lines, cells, learningCurves } = snapshot;

  const result = applyRipple({
    ...params,
    orders,
    styles,
    lines,
    cells,
    learningCurves,
    lineSplitOverrides: params.lineSplitOverrides,
  });

  const orderStatuses: Record<string, Order["status"]> = {};
  for (const order of orders) {
    const completion = result.newProjections[order.id];
    if (!completion) continue;
    orderStatuses[order.id] = deriveOrderStatus(
      completion,
      order.deliveryDeadline
    );
  }

  if (snapshot.source === "supabase") {
    await persistCells(snapshot.organization.id, result.updatedCells, orderStatuses);
  }

  return {
    ...result,
    snapshot: {
      ...snapshot,
      cells: result.updatedCells,
      orders: orders.map((o) => ({
        ...o,
        status: orderStatuses[o.id] ?? o.status,
      })),
      materialGates: getMaterialGates(orders, result.updatedCells),
    },
  };
}

export async function applyLineSplitRecovery(
  orderId: string,
  lineIds: string[],
  ratios: number[]
): Promise<RippleResult & { snapshot: ScheduleSnapshot }> {
  const snapshot = await getScheduleSnapshot();
  const lockedCells = snapshot.cells.filter((c) => c.locked);

  const result = buildSchedule({
    orders: snapshot.orders,
    styles: snapshot.styles,
    lines: snapshot.lines,
    learningCurves: snapshot.learningCurves,
    existingLocks: lockedCells,
    lineSplitOverrides: [
      { orderId, stage: "sewing", lineIds, ratios },
    ],
    horizonDays: REPLAN_HORIZON_DAYS,
  });

  const warnings: string[] = [
    `Line split applied across ${lineIds.length} sewing lines for order ${orderId}.`,
  ];

  const updatedCells = result.cells.map((c) => ({
    ...c,
    status: c.locked ? c.status : ("projected" as const),
  }));

  if (snapshot.source === "supabase") {
    await persistCells(
      snapshot.organization.id,
      updatedCells,
      result.orderStatuses
    );
  }

  return {
    updatedCells,
    affectedOrders: [orderId],
    newProjections: result.orderCompletions,
    warnings,
    snapshot: {
      ...snapshot,
      cells: updatedCells,
      orders: snapshot.orders.map((o) => ({
        ...o,
        status: result.orderStatuses[o.id] ?? o.status,
      })),
      materialGates: getMaterialGates(snapshot.orders, updatedCells),
    },
  };
}
