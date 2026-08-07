/**
 * Every operation the engine knows how to model. Not every factory runs all
 * of them — which ones apply, and in what order, is a `RouteTemplate`, not a
 * property of this type. Kept as a union rather than a bare string so
 * exhaustiveness checks still catch a missed stage at compile time; the
 * "configured per organisation" part is the route, layered on top.
 */
export type StageCode =
  | "knitting"
  | "cutting"
  | "sewing"
  | "linking"
  | "finishing"
  | "wash"
  | "packing"
  | "dispatch";

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
  /**
   * Minutes per unit at each operation. Populated for every `StageCode` for
   * simplicity, but only the ones on this style's route are ever read — an
   * unrouted operation's value is inert, not a claim about its cost.
   */
  smv: Record<StageCode, number>;
  fabricType?: FabricType;
  /** Which `RouteTemplate` this style runs. Falls back to `DEFAULT_ROUTE_ID`. */
  routeId?: string;
  /**
   * Per-line exceptions to `smv`, keyed by line id. Sparse by design: most
   * lines run a style at its standard rate, so only the lines where tooling
   * genuinely changes the minutes-per-unit — a newer machine, an older one —
   * need an entry here. Absent is not zero; it means "use `smv`".
   */
  lineSmv?: Record<string, Partial<Record<StageCode, number>>>;
}

/**
 * The minutes-per-unit for a style at a stage, on a specific line when one is
 * known. Line-specific tooling can make the same operation faster or slower
 * than the style's standard rate; most lines have no override and simply run
 * the standard number.
 */
export function smvFor(
  style: Style,
  stage: StageCode,
  lineId?: string
): number {
  const override = lineId ? style.lineSmv?.[lineId]?.[stage] : undefined;
  return override ?? style.smv[stage];
}

/**
 * The operations an order's style runs, in pipeline order. Two styles can
 * differ here without differing in anything else: a factory that buys
 * finished fabric skips knitting, one that buys undyed greige adds wash. This
 * is what makes that a data choice instead of a code path.
 */
export interface RouteTemplate {
  id: string;
  name: string;
  operations: StageCode[];
}

export const ROUTE_TEMPLATES: Record<string, RouteTemplate> = {
  "knit-to-pack": {
    id: "knit-to-pack",
    name: "Knit to pack",
    operations: ["knitting", "cutting", "sewing", "packing"],
  },
  "cut-to-pack": {
    id: "cut-to-pack",
    name: "Cut to pack",
    operations: ["cutting", "sewing", "packing"],
  },
};

/** Used when a style names no route, so pre-existing styles keep scheduling. */
export const DEFAULT_ROUTE_ID = "knit-to-pack";

export function stagesForRoute(routeId: string | undefined): StageCode[] {
  return (
    ROUTE_TEMPLATES[routeId ?? DEFAULT_ROUTE_ID]?.operations ??
    ROUTE_TEMPLATES[DEFAULT_ROUTE_ID]!.operations
  );
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

/**
 * Every operation in pipeline position, independent of any one route. A
 * route's `operations` is always a subsequence of this, so "the stage before
 * mine" is well-defined even for an operation two routes disagree on running.
 */
export const STAGE_ORDER: StageCode[] = [
  "knitting",
  "cutting",
  "sewing",
  "linking",
  "finishing",
  "wash",
  "packing",
  "dispatch",
];

export const STAGE_LABELS: Record<StageCode, string> = {
  knitting: "Knitting",
  cutting: "Cutting",
  sewing: "Sewing",
  linking: "Linking",
  finishing: "Finishing",
  wash: "Wash",
  packing: "Packing",
  dispatch: "Dispatch",
};

export const STAGE_COLORS: Record<StageCode, string> = {
  knitting: "#8b5cf6",
  cutting: "#06b6d4",
  sewing: "#f97316",
  linking: "#eab308",
  finishing: "#ec4899",
  wash: "#0ea5e9",
  packing: "#22c55e",
  dispatch: "#64748b",
};

export const PACKING_DRAG: Record<PackingType, number> = {
  solid: 1.0,
  assorted: 1.45,
};
