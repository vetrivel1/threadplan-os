export type StageCode = "knitting" | "cutting" | "sewing" | "packing";

export type PackingType = "solid" | "assorted";

export type OrderStatus =
  | "planned"
  | "in_progress"
  | "at_risk"
  | "delayed"
  | "completed";

export type ScheduleCellStatus = "planned" | "locked" | "actual" | "projected";

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface ProductionLine {
  id: string;
  organizationId: string;
  name: string;
  stage: StageCode;
  operators: number;
  shiftMinutes: number;
  efficiencyBaseline: number;
}

export interface Style {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  complexity: number;
  smv: Record<StageCode, number>;
}

export interface LearningCurvePoint {
  day: number;
  efficiency: number;
}

export interface Order {
  id: string;
  organizationId: string;
  orderNumber: string;
  styleId: string;
  quantity: number;
  packingType: PackingType;
  rmInHouseDate: string;
  deliveryDeadline: string;
  priority: number;
  status: OrderStatus;
}

export interface ScheduleCell {
  id: string;
  orderId: string;
  lineId: string;
  stage: StageCode;
  date: string;
  plannedQty: number;
  actualQty: number | null;
  locked: boolean;
  status: ScheduleCellStatus;
  efficiency: number;
  capacityUsed: number;
}

export interface MaterialGate {
  orderId: string;
  orderNumber: string;
  rmInHouseDate: string;
  earliestStart: string;
  blocked: boolean;
}

export interface RecoveryOption {
  id: string;
  type: "overtime" | "sequence_swap" | "line_split" | "expedite_stage";
  title: string;
  description: string;
  impactDays: number;
  costIndex: number;
  confidence: number;
  isRecommended: boolean;
  details: Record<string, unknown>;
}

export interface AIRecommendation {
  orderId: string;
  orderNumber: string;
  daysLate: number;
  summary: string;
  options: RecoveryOption[];
  generatedAt: string;
}

export interface ScheduleSnapshot {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  cells: ScheduleCell[];
  materialGates: MaterialGate[];
  learningCurves: Record<string, LearningCurvePoint[]>;
}

export interface RippleResult {
  updatedCells: ScheduleCell[];
  affectedOrders: string[];
  newProjections: Record<string, string>;
  warnings: string[];
}

export const STAGE_ORDER: StageCode[] = [
  "knitting",
  "cutting",
  "sewing",
  "packing",
];

export const STAGE_LABELS: Record<StageCode, string> = {
  knitting: "Knitting",
  cutting: "Cutting",
  sewing: "Sewing",
  packing: "Packing",
};

export const STAGE_COLORS: Record<StageCode, string> = {
  knitting: "#8b5cf6",
  cutting: "#06b6d4",
  sewing: "#f97316",
  packing: "#22c55e",
};

export const PACKING_DRAG: Record<PackingType, number> = {
  solid: 1.0,
  assorted: 1.45,
};
