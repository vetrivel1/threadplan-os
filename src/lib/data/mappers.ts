import type {
  LearningCurvePoint,
  Order,
  OrderStatus,
  PackingType,
  ProductionLine,
  ScheduleCell,
  StageCode,
  Style,
} from "@/lib/types";

export interface DbLine {
  id: string;
  organization_id: string;
  name: string;
  stage: StageCode;
  operators: number;
  shift_minutes: number;
  efficiency_baseline: number;
}

export interface DbStyle {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  complexity: number;
  smv_knitting: number;
  smv_cutting: number;
  smv_sewing: number;
  smv_packing: number;
}

export interface DbOrder {
  id: string;
  organization_id: string;
  order_number: string;
  style_id: string;
  quantity: number;
  packing_type: PackingType;
  rm_in_house_date: string;
  delivery_deadline: string;
  priority: number;
  status: OrderStatus;
}

export interface DbCell {
  id: string;
  organization_id: string;
  order_id: string;
  line_id: string;
  stage: StageCode;
  schedule_date: string;
  planned_qty: number;
  actual_qty: number | null;
  locked: boolean;
  efficiency: number | null;
  capacity_used: number | null;
}

export interface DbLearningCurve {
  style_id: string;
  day_number: number;
  efficiency: number;
}

export function mapLine(row: DbLine): ProductionLine {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    stage: row.stage,
    operators: row.operators,
    shiftMinutes: row.shift_minutes,
    efficiencyBaseline: Number(row.efficiency_baseline),
  };
}

export function mapStyle(row: DbStyle): Style {
  return {
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name,
    complexity: Number(row.complexity),
    smv: {
      knitting: Number(row.smv_knitting),
      cutting: Number(row.smv_cutting),
      sewing: Number(row.smv_sewing),
      packing: Number(row.smv_packing),
    },
  };
}

export function mapOrder(row: DbOrder): Order {
  return {
    id: row.id,
    organizationId: row.organization_id,
    orderNumber: row.order_number,
    styleId: row.style_id,
    quantity: row.quantity,
    packingType: row.packing_type,
    rmInHouseDate: row.rm_in_house_date,
    deliveryDeadline: row.delivery_deadline,
    priority: row.priority,
    status: row.status,
  };
}

export function mapCell(row: DbCell): ScheduleCell {
  return {
    id: row.id,
    orderId: row.order_id,
    lineId: row.line_id,
    stage: row.stage,
    date: row.schedule_date,
    plannedQty: row.planned_qty,
    actualQty: row.actual_qty,
    locked: row.locked,
    status: row.locked
      ? row.actual_qty != null
        ? "actual"
        : "locked"
      : "planned",
    efficiency: Number(row.efficiency ?? 0),
    capacityUsed: row.capacity_used ?? row.planned_qty,
  };
}

export function mapCellToDb(
  cell: ScheduleCell,
  organizationId: string
): Omit<DbCell, "id"> & { id?: string } {
  return {
    id: cell.id.includes("-") && cell.id.length > 36 ? undefined : cell.id,
    organization_id: organizationId,
    order_id: cell.orderId,
    line_id: cell.lineId,
    stage: cell.stage,
    schedule_date: cell.date,
    planned_qty: cell.plannedQty,
    actual_qty: cell.actualQty,
    locked: cell.locked,
    efficiency: cell.efficiency,
    capacity_used: cell.capacityUsed,
  };
}

export function buildLearningCurves(
  rows: DbLearningCurve[]
): Record<string, LearningCurvePoint[]> {
  const curves: Record<string, LearningCurvePoint[]> = {};
  for (const row of rows) {
    if (!curves[row.style_id]) curves[row.style_id] = [];
    curves[row.style_id]!.push({
      day: row.day_number,
      efficiency: Number(row.efficiency),
    });
  }
  for (const styleId of Object.keys(curves)) {
    curves[styleId]!.sort((a, b) => a.day - b.day);
  }
  return curves;
}

export function mapOrderToDb(
  order: Order
): Omit<DbOrder, "organization_id"> & { organization_id: string } {
  return {
    id: order.id,
    organization_id: order.organizationId,
    order_number: order.orderNumber,
    style_id: order.styleId,
    quantity: order.quantity,
    packing_type: order.packingType,
    rm_in_house_date: order.rmInHouseDate,
    delivery_deadline: order.deliveryDeadline,
    priority: order.priority,
    status: order.status,
  };
}
