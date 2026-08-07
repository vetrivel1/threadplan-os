/**
 * Deterministic dataset for engine verification.
 *
 * The demo seed in src/lib/seed/demo-data.ts anchors its dates to "today", which
 * makes its output impossible to compare across runs. This fixture reproduces the
 * same shape against a fixed anchor so golden snapshots stay stable.
 */

import type {
  Colourway,
  LearningCurvePoint,
  Order,
  PackRatio,
  ProductionLine,
  Style,
} from "../src/lib/types";

export const ANCHOR_DATE = "2026-01-05";
const ORG = "org-demo-001";

/** See the identical constant in src/lib/seed/demo-data.ts for the rationale. */
const UNROUTED_SMV = { linking: 0, finishing: 0, wash: 0, dispatch: 0 } as const;

function anchorPlus(days: number): string {
  const d = new Date(`${ANCHOR_DATE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}

const ASSORTED_CARTON: PackRatio = {
  mode: "assorted",
  sizes: { S: 2, M: 3, L: 3, XL: 2 },
  unitsPerCarton: 10,
};

const SOLID_CARTON: PackRatio = {
  mode: "solid",
  sizes: {},
  unitsPerCarton: 60,
};

const SIZE_CURVE: Array<[string, number]> = [
  ["S", 0.2],
  ["M", 0.3],
  ["L", 0.3],
  ["XL", 0.2],
];

function colourway(colour: string, qty: number): Colourway {
  return {
    colour,
    sizes: SIZE_CURVE.map(([size, share]) => ({
      size,
      qty: Math.round(qty * share),
    })),
  };
}

export const FIXTURE_LINES: ProductionLine[] = [
  {
    id: "line-knit-1",
    organizationId: ORG,
    name: "Knit Line A",
    stage: "knitting",
    operators: 24,
    shiftMinutes: 480,
    efficiencyBaseline: 0.92,
  },
  {
    id: "line-cut-1",
    organizationId: ORG,
    name: "Cut Line A",
    stage: "cutting",
    operators: 18,
    shiftMinutes: 480,
    efficiencyBaseline: 0.9,
  },
  {
    id: "line-sew-1",
    organizationId: ORG,
    name: "Sew Line A",
    stage: "sewing",
    operators: 32,
    shiftMinutes: 480,
    efficiencyBaseline: 0.88,
  },
  {
    id: "line-sew-2",
    organizationId: ORG,
    name: "Sew Line B",
    stage: "sewing",
    operators: 28,
    shiftMinutes: 480,
    efficiencyBaseline: 0.85,
  },
  {
    id: "line-pack-1",
    organizationId: ORG,
    name: "Pack Line A",
    stage: "packing",
    operators: 12,
    shiftMinutes: 480,
    efficiencyBaseline: 0.95,
  },
];

export const FIXTURE_STYLES: Style[] = [
  {
    id: "style-polo-01",
    organizationId: ORG,
    code: "PL-4421",
    name: "Classic Polo",
    complexity: 1.2,
    smv: { ...UNROUTED_SMV, knitting: 4.2, cutting: 2.8, sewing: 12.5, packing: 1.8 },
    fabricType: "pique",
  },
  {
    id: "style-hood-02",
    organizationId: ORG,
    code: "HD-8830",
    name: "Fleece Hoodie",
    complexity: 1.8,
    smv: { ...UNROUTED_SMV, knitting: 6.1, cutting: 3.5, sewing: 18.2, packing: 2.4 },
    fabricType: "fleece",
  },
  {
    id: "style-tee-03",
    organizationId: ORG,
    code: "TS-1105",
    name: "Basic Tee",
    complexity: 0.9,
    // Jersey is bought as greige-dyed roll goods rather than knit in-house,
    // so this style's route starts at cutting. Mirrors demo-data.ts.
    smv: { ...UNROUTED_SMV, knitting: 3.1, cutting: 2.1, sewing: 8.4, packing: 1.2 },
    fabricType: "jersey",
    routeId: "cut-to-pack",
  },
  {
    id: "style-jog-04",
    organizationId: ORG,
    code: "JG-2290",
    name: "Jogger Pant",
    complexity: 1.5,
    smv: { ...UNROUTED_SMV, knitting: 5.0, cutting: 3.2, sewing: 15.6, packing: 2.1 },
    fabricType: "french_terry",
  },
];

export const FIXTURE_CURVES: Record<string, LearningCurvePoint[]> = {
  "style-polo-01": [
    { day: 1, efficiency: 0.58 },
    { day: 2, efficiency: 0.72 },
    { day: 3, efficiency: 0.82 },
    { day: 4, efficiency: 0.9 },
    { day: 5, efficiency: 0.96 },
    { day: 6, efficiency: 1.0 },
  ],
  "style-hood-02": [
    { day: 1, efficiency: 0.5 },
    { day: 2, efficiency: 0.62 },
    { day: 3, efficiency: 0.74 },
    { day: 4, efficiency: 0.84 },
    { day: 5, efficiency: 0.91 },
    { day: 6, efficiency: 0.96 },
    { day: 7, efficiency: 1.0 },
  ],
  "style-tee-03": [
    { day: 1, efficiency: 0.65 },
    { day: 2, efficiency: 0.78 },
    { day: 3, efficiency: 0.88 },
    { day: 4, efficiency: 0.95 },
    { day: 5, efficiency: 1.0 },
  ],
  "style-jog-04": [
    { day: 1, efficiency: 0.55 },
    { day: 2, efficiency: 0.68 },
    { day: 3, efficiency: 0.79 },
    { day: 4, efficiency: 0.87 },
    { day: 5, efficiency: 0.93 },
    { day: 6, efficiency: 1.0 },
  ],
};

export const FIXTURE_ORDERS: Order[] = [
  {
    id: "ord-001",
    organizationId: ORG,
    orderNumber: "PO-2026-1042",
    styleId: "style-tee-03",
    quantity: 4800,
    packingType: "solid",
    rmInHouseDate: anchorPlus(-2),
    deliveryDeadline: anchorPlus(14),
    priority: 10,
    status: "in_progress",
    colourways: [colourway("White", 4800)],
    packRatio: SOLID_CARTON,
  },
  {
    id: "ord-002",
    organizationId: ORG,
    orderNumber: "PO-2026-1087",
    styleId: "style-polo-01",
    quantity: 3200,
    packingType: "assorted",
    rmInHouseDate: anchorPlus(1),
    deliveryDeadline: anchorPlus(18),
    priority: 20,
    status: "planned",
    colourways: [colourway("Navy", 1600), colourway("White", 1600)],
    packRatio: ASSORTED_CARTON,
  },
  {
    id: "ord-003",
    organizationId: ORG,
    orderNumber: "PO-2026-1103",
    styleId: "style-hood-02",
    quantity: 2400,
    packingType: "assorted",
    rmInHouseDate: anchorPlus(3),
    materials: [
      { name: "Fleece body fabric", inHouseDate: anchorPlus(3) },
      { name: "Drawcord + eyelets", inHouseDate: anchorPlus(4) },
      { name: "Care labels", inHouseDate: anchorPlus(2) },
    ],
    deliveryDeadline: anchorPlus(22),
    priority: 30,
    status: "planned",
    colourways: [colourway("Charcoal", 1200), colourway("Forest", 1200)],
    packRatio: ASSORTED_CARTON,
  },
  {
    id: "ord-004",
    organizationId: ORG,
    orderNumber: "PO-2026-1118",
    styleId: "style-jog-04",
    quantity: 3600,
    packingType: "solid",
    rmInHouseDate: anchorPlus(5),
    materials: [
      { name: "French terry fabric", inHouseDate: anchorPlus(5) },
      { name: "Waistband elastic", inHouseDate: anchorPlus(5) },
      { name: "Zip pulls", inHouseDate: anchorPlus(4) },
    ],
    deliveryDeadline: anchorPlus(12),
    priority: 5,
    status: "at_risk",
    colourways: [colourway("Black", 3600)],
    packRatio: SOLID_CARTON,
  },
  {
    id: "ord-005",
    organizationId: ORG,
    orderNumber: "PO-2026-1135",
    styleId: "style-tee-03",
    quantity: 6000,
    packingType: "assorted",
    rmInHouseDate: anchorPlus(7),
    deliveryDeadline: anchorPlus(28),
    priority: 40,
    status: "planned",
    colourways: [
      colourway("Heather", 2000),
      colourway("Sand", 2000),
      colourway("Black", 2000),
    ],
    packRatio: ASSORTED_CARTON,
  },
];
