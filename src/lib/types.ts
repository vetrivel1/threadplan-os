export type StageCode = "knitting" | "cutting" | "sewing" | "packing";

export type PackingType = "solid" | "assorted";

/**
 * Base fabric a style is built from. Drives part of the changeover penalty when
 * a line switches between styles that need different handling.
 */
export type FabricType = "jersey" | "pique" | "fleece" | "french_terry";

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
  fabricType?: FabricType;
}

export interface LearningCurvePoint {
  day: number;
  efficiency: number;
}

/** Quantity of a single size. */
export interface SizeQty {
  size: string;
  qty: number;
}

/**
 * One colour of an order, broken down by size.
 *
 * Colour is carried here rather than on the order so a single order can hold
 * several colourways, which is what makes a mid-run colour change expressible.
 */
export interface Colourway {
  colour: string;
  /** Thread shade, when it differs from the body colour. Drives changeover. */
  thread?: string;
  sizes: SizeQty[];
}

/**
 * How a shipping carton is made up.
 *
 * `assorted` cartons need every size present in ratio — 10 small, 10 medium,
 * 10 large — so a carton closes only when the scarcest size is available.
 * `solid` cartons hold one size each, so every size closes independently.
 */
export interface PackRatio {
  mode: PackingType;
  /** Units of each size in one assorted carton. Ignored when mode is solid. */
  sizes: Record<string, number>;
  unitsPerCarton: number;
}

/**
 * A single raw material line for an order. Fabric, trims and labels arrive
 * separately, so the real production gate is the latest of them.
 */
export interface OrderMaterial {
  name: string;
  inHouseDate: string;
}

export interface Order {
  id: string;
  organizationId: string;
  orderNumber: string;
  styleId: string;
  quantity: number;
  packingType: PackingType;
  /** Fallback gate used when `materials` is absent. */
  rmInHouseDate: string;
  materials?: OrderMaterial[];
  deliveryDeadline: string;
  priority: number;
  status: OrderStatus;
  /**
   * Size and colour breakdown. When absent the order is treated as a single
   * unnamed size, which keeps orders that predate the breakdown schedulable.
   */
  colourways?: Colourway[];
  packRatio?: PackRatio;
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
  /**
   * What this cell's output was made up of, by size. Only populated when
   * pack-ratio physics is on, so legacy plans stay byte-identical.
   */
  sizeMix?: Record<string, number>;
  /** Which colourway this cell ran. A line holds one colour at a time. */
  colour?: string;
}

export interface MaterialGate {
  orderId: string;
  orderNumber: string;
  /** Raw date as supplied, kept for display. */
  rmInHouseDate: string;
  /** Latest material date plus buffer — the date production is actually gated on. */
  effectiveRmDate: string;
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
