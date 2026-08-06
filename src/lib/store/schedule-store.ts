import { create } from "zustand";
import type {
  AIRecommendation,
  LearningCurvePoint,
  Order,
  Organization,
  PackingType,
  ProductionLine,
  ScheduleCell,
  StageCode,
  Style,
} from "@/lib/types";
import {
  DEMO_LEARNING_CURVES,
  DEMO_LINES,
  DEMO_ORDERS,
  DEMO_ORG,
  DEMO_STYLES,
  buildInitialSchedule,
} from "@/lib/seed/demo-data";
import { getMaterialGates } from "@/lib/engine/scheduler";
import { applyRipple } from "@/lib/engine/ripple";
import { runAutoSequence } from "@/lib/engine/run-sequence";
import { deriveOrderStatus } from "@/lib/engine/sequencing-policy";

export interface SimulatedOrderInput {
  orderNumber: string;
  styleId: string;
  quantity: number;
  packingType: PackingType;
  rmInHouseDate: string;
  deliveryDeadline: string;
  priority: number;
}

interface ScheduleStore {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  cells: ScheduleCell[];
  organization: Organization;
  organizationId: string;
  source: "demo" | "supabase";
  isLoading: boolean;
  selectedCell: ScheduleCell | null;
  aiRecommendation: AIRecommendation | null;
  isAiLoading: boolean;
  rippleWarnings: string[];
  lastSequenceRun: string | null;
  /** Proposed plan after Lock & Auto Replan — not committed until confirm */
  pendingCells: ScheduleCell[] | null;
  pendingOrders: Order[] | null;
  pendingWarnings: string[];
  pendingEdit: {
    orderId: string;
    lineId: string;
    stage: StageCode;
    date: string;
    actualQty: number;
  } | null;
  isConfirming: boolean;

  hydrate: () => Promise<void>;
  setCells: (
    cells: ScheduleCell[] | ((prev: ScheduleCell[]) => ScheduleCell[])
  ) => void;
  setOrders: (orders: Order[]) => void;
  selectCell: (cell: ScheduleCell | null) => void;
  simulateErpOrder: (input: SimulatedOrderInput) => void;
  /** Compute ripple and show as overlap preview — does not commit */
  previewRippleEdit: (
    orderId: string,
    lineId: string,
    stage: StageCode,
    date: string,
    actualQty: number
  ) => Promise<void>;
  confirmRippleEdit: () => Promise<void>;
  discardRippleEdit: () => void;
  applyRecovery: (orderId: string, optionId: string) => Promise<void>;
  setAiRecommendation: (rec: AIRecommendation | null) => void;
  setAiLoading: (loading: boolean) => void;
  getMaterialGates: () => ReturnType<typeof getMaterialGates>;
}

const initialCells = buildInitialSchedule();

const CLEARED_PENDING = {
  pendingCells: null,
  pendingOrders: null,
  pendingWarnings: [] as string[],
  pendingEdit: null,
} as const;

function sequenceState(
  orders: Order[],
  styles: Style[],
  lines: ProductionLine[],
  learningCurves: Record<string, LearningCurvePoint[]>,
  existingLocks: ScheduleCell[] = []
) {
  return runAutoSequence({
    orders,
    styles,
    lines,
    learningCurves,
    existingLocks,
  });
}

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  orders: DEMO_ORDERS,
  styles: DEMO_STYLES,
  lines: DEMO_LINES,
  learningCurves: DEMO_LEARNING_CURVES,
  cells: initialCells,
  organization: DEMO_ORG,
  organizationId: DEMO_ORG.id,
  source: "demo",
  isLoading: false,
  selectedCell: null,
  aiRecommendation: null,
  isAiLoading: false,
  rippleWarnings: [],
  lastSequenceRun: null,
  pendingCells: null,
  pendingOrders: null,
  pendingWarnings: [],
  pendingEdit: null,
  isConfirming: false,

  hydrate: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/schedule");
      if (!res.ok) throw new Error("Failed to load schedule");
      const data = await res.json();
      set({
        orders: data.orders,
        styles: data.styles,
        lines: data.lines,
        cells: data.cells,
        learningCurves: data.learningCurves,
        organization: data.organization,
        organizationId: data.organization.id,
        source: data.source,
        lastSequenceRun: new Date().toISOString(),
        // A new baseline invalidates any preview overlaid on the old one
        ...CLEARED_PENDING,
      });
    } catch {
      // keep demo defaults
    } finally {
      set({ isLoading: false });
    }
  },

  setCells: (cellsOrFn) => {
    set((state) => ({
      cells:
        typeof cellsOrFn === "function" ? cellsOrFn(state.cells) : cellsOrFn,
    }));
  },

  setOrders: (orders) => set({ orders }),

  selectCell: (cell) => set({ selectedCell: cell }),

  simulateErpOrder: (input) => {
    const state = get();
    const newOrder: Order = {
      id: `ord-${Date.now()}`,
      organizationId: state.organizationId,
      orderNumber: input.orderNumber,
      styleId: input.styleId,
      quantity: input.quantity,
      packingType: input.packingType,
      rmInHouseDate: input.rmInHouseDate,
      deliveryDeadline: input.deliveryDeadline,
      priority: input.priority,
      status: "planned",
    };

    const orders = [...state.orders, newOrder];
    const locked = state.cells.filter((c) => c.locked);
    const { cells, orders: sequencedOrders } = sequenceState(
      orders,
      state.styles,
      state.lines,
      state.learningCurves,
      locked
    );

    set({
      orders: sequencedOrders,
      cells,
      lastSequenceRun: new Date().toISOString(),
      rippleWarnings: [
        `ERP order ${newOrder.orderNumber} received — auto-sequence re-run for ${orders.length} orders.`,
      ],
      selectedCell: null,
      ...CLEARED_PENDING,
    });
  },

  previewRippleEdit: async (orderId, lineId, stage, date, actualQty) => {
    const state = get();

    // Always compute locally so nothing is persisted until Confirm
    const result = applyRipple({
      orderId,
      lineId,
      stage,
      date,
      actualQty,
      orders: state.orders,
      styles: state.styles,
      lines: state.lines,
      cells: state.cells,
      learningCurves: state.learningCurves,
    });

    const pendingOrders = state.orders.map((o) => {
      const completion = result.newProjections[o.id];
      if (!completion) {
        const warned = result.warnings.some((w) => w.includes(o.orderNumber));
        if (warned) return { ...o, status: "delayed" as const };
        return o;
      }
      // Match the server's classification so preview and commit agree
      return { ...o, status: deriveOrderStatus(completion, o.deliveryDeadline) };
    });

    set({
      pendingCells: result.updatedCells,
      pendingOrders,
      pendingWarnings: result.warnings,
      pendingEdit: { orderId, lineId, stage, date, actualQty },
    });
  },

  confirmRippleEdit: async () => {
    const state = get();
    if (!state.pendingCells || !state.pendingEdit || state.isConfirming) return;

    const pendingCells = state.pendingCells;
    const pendingOrders = state.pendingOrders;
    const pendingWarnings = state.pendingWarnings;
    const pendingEdit = state.pendingEdit;

    const commitLocally = () =>
      set({
        cells: pendingCells,
        orders: pendingOrders ?? get().orders,
        rippleWarnings: pendingWarnings,
        selectedCell: null,
        isConfirming: false,
        lastSequenceRun: new Date().toISOString(),
        ...CLEARED_PENDING,
      });

    if (state.source === "demo") {
      commitLocally();
      return;
    }

    // Guard against a second Confirm while the request is in flight
    set({ isConfirming: true });

    try {
      const res = await fetch("/api/ripple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingEdit),
      });

      if (!res.ok) {
        commitLocally();
        return;
      }

      const data = await res.json();
      set({
        cells: data.updatedCells,
        orders: data.snapshot.orders,
        rippleWarnings: data.warnings,
        selectedCell: null,
        isConfirming: false,
        lastSequenceRun: new Date().toISOString(),
        ...CLEARED_PENDING,
      });
    } catch {
      commitLocally();
    }
  },

  discardRippleEdit: () => {
    set({ ...CLEARED_PENDING });
  },

  applyRecovery: async (orderId, optionId) => {
    const res = await fetch("/api/recovery/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, optionId }),
    });

    if (!res.ok) return;

    const data = await res.json();
    set({
      cells: data.updatedCells,
      orders: data.snapshot.orders,
      rippleWarnings: data.warnings,
      aiRecommendation: null,
      selectedCell: null,
      lastSequenceRun: new Date().toISOString(),
      ...CLEARED_PENDING,
    });
  },

  setAiRecommendation: (rec) => set({ aiRecommendation: rec }),
  setAiLoading: (loading) => set({ isAiLoading: loading }),

  getMaterialGates: () => {
    const { orders, cells } = get();
    return getMaterialGates(orders, cells);
  },
}));

export { DEMO_STYLES, DEMO_LINES, DEMO_LEARNING_CURVES };
