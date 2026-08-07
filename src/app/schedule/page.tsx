"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO, addDays, eachDayOfInterval } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Pencil, X, Sparkles } from "lucide-react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import {
  STAGE_COLORS,
  STAGE_LABELS,
  STAGE_ORDER,
  type ScheduleCell,
  type StageCode,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { CopilotPanel } from "@/components/ai/CopilotPanel";
import { MaterialGateBar } from "@/components/schedule/MaterialGateBar";

const CELL_WIDTH = 72;
const ROW_HEIGHT = 44;

export default function SchedulePage() {
  const {
    orders,
    cells,
    styles,
    lines,
    selectedCell,
    selectCell,
    previewRippleEdit,
    confirmRippleEdit,
    discardRippleEdit,
    rippleWarnings,
    pendingCells,
    pendingWarnings,
    getMaterialGates,
  } = useScheduleStore();

  const [editValue, setEditValue] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [showAiReplan, setShowAiReplan] = useState(false);
  const [aiReplanOrderId, setAiReplanOrderId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const gates = useMemo(
    () => getMaterialGates(),
    // getMaterialGates reads orders+cells from the store
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getMaterialGates, orders, cells]
  );
  const hasPending = pendingCells != null && pendingCells.length > 0;

  // Drop an uncommitted preview if the planner navigates away
  useEffect(() => {
    return () => {
      const { pendingEdit, discardRippleEdit, selectCell } =
        useScheduleStore.getState();
      if (pendingEdit) discardRippleEdit();
      selectCell(null);
    };
  }, []);

  const { dates, rows } = useMemo(() => {
    const scheduleCells = [
      ...cells,
      ...(pendingCells ?? []),
    ];
    if (scheduleCells.length === 0 && orders.length === 0)
      return { dates: [], rows: [] };

    const allDates = [
      ...scheduleCells.map((c) => c.date),
      ...orders.map((o) => o.rmInHouseDate),
    ].sort();
    if (allDates.length === 0) return { dates: [], rows: [] };

    const start = parseISO(allDates[0]!);
    const end = parseISO(allDates[allDates.length - 1]!);
    const dateRange = eachDayOfInterval({ start, end: addDays(end, 2) }).map(
      (d) => format(d, "yyyy-MM-dd")
    );

    const rowMap = new Map<
      string,
      { orderId: string; stage: StageCode; lineId: string }
    >();
    for (const cell of scheduleCells) {
      const key = `${cell.orderId}:${cell.stage}:${cell.lineId}`;
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          orderId: cell.orderId,
          stage: cell.stage,
          lineId: cell.lineId,
        });
      }
    }

    const rows = [...rowMap.values()].sort((a, b) => {
      const orderA = orders.find((o) => o.id === a.orderId);
      const orderB = orders.find((o) => o.id === b.orderId);
      const prio = (orderA?.priority ?? 0) - (orderB?.priority ?? 0);
      if (prio !== 0) return prio;
      const stageIdx = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
      if (stageIdx !== 0) return stageIdx;
      return a.lineId.localeCompare(b.lineId);
    });

    return { dates: dateRange, rows };
  }, [cells, pendingCells, orders]);

  const cellMap = useMemo(() => {
    const map = new Map<string, ScheduleCell>();
    for (const c of cells) {
      map.set(`${c.orderId}:${c.stage}:${c.lineId}:${c.date}`, c);
    }
    return map;
  }, [cells]);

  const pendingMap = useMemo(() => {
    const map = new Map<string, ScheduleCell>();
    for (const c of pendingCells ?? []) {
      map.set(`${c.orderId}:${c.stage}:${c.lineId}:${c.date}`, c);
    }
    return map;
  }, [pendingCells]);

  const handleCellClick = (cell: ScheduleCell) => {
    if (hasPending) return; // finish confirm/discard first
    selectCell(cell);
    setEditValue(String(cell.actualQty ?? cell.plannedQty));
  };

  const handleRipplePreview = async () => {
    if (!selectedCell) return;
    const qty = parseInt(editValue, 10);
    if (isNaN(qty) || qty < 0) return;
    setIsPreviewing(true);
    try {
      await previewRippleEdit(
        selectedCell.orderId,
        selectedCell.lineId,
        selectedCell.stage,
        selectedCell.date,
        qty
      );
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirmPlan = async () => {
    await confirmRippleEdit();
  };

  const handleDiscardPlan = () => {
    discardRippleEdit();
  };

  const handleClosePanel = () => {
    if (hasPending) discardRippleEdit();
    selectCell(null);
  };

  /** Orders projected past delivery — from deadline warnings only */
  const ordersPastDeadline = useMemo(() => {
    const warnings = hasPending ? pendingWarnings : rippleWarnings;
    const found: typeof orders = [];
    for (const w of warnings) {
      if (!w.includes("past delivery deadline")) continue;
      const match = w.match(/Order (PO-[\d-]+)/);
      if (!match) continue;
      const o = orders.find((x) => x.orderNumber === match[1]);
      if (o && !found.find((x) => x.id === o.id)) found.push(o);
    }
    return found;
  }, [orders, hasPending, pendingWarnings, rippleWarnings]);

  const committedPastDeadline = useMemo(() => {
    const found: typeof orders = [];
    for (const w of rippleWarnings) {
      if (!w.includes("past delivery deadline")) continue;
      const match = w.match(/Order (PO-[\d-]+)/);
      if (!match) continue;
      const o = orders.find((x) => x.orderNumber === match[1]);
      if (o && !found.find((x) => x.id === o.id)) found.push(o);
    }
    return found;
  }, [orders, rippleWarnings]);

  const pendingNeedsAi = pendingWarnings.some((w) =>
    w.includes("past delivery deadline")
  );

  const openAiReplan = (orderId: string) => {
    setInfoMessage(null);
    setAiReplanOrderId(orderId);
    setShowAiReplan(true);
  };

  /** Confirm cascade first (AI needs committed baseline), then open recovery */
  const handleTryAiReplan = async () => {
    const orderId =
      ordersPastDeadline[0]?.id ?? selectedCell?.orderId ?? null;
    if (!orderId) return;
    if (hasPending) {
      await confirmRippleEdit();
    }
    openAiReplan(orderId);
  };

  return (
    <div className="flex h-[calc(100vh-49px)] flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <h1 className="text-lg font-bold">Auto Plan</h1>
        <p className="text-xs text-muted">
          Lock actuals to preview cascade — Try AI Replan only if delivery is
          still at risk
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
          <LegendItem color={STAGE_COLORS.knitting} label="Knit" />
          <LegendItem color={STAGE_COLORS.cutting} label="Cut" />
          <LegendItem color={STAGE_COLORS.sewing} label="Sew" />
          <LegendItem color={STAGE_COLORS.packing} label="Pack" />
          <span className="flex items-center gap-1 text-muted">
            <Lock className="h-2.5 w-2.5" /> Locked
          </span>
          <span className="flex items-center gap-1 text-muted">
            <span className="h-2 w-2 rounded-sm border border-dashed border-muted" />{" "}
            Current
          </span>
          <span className="flex items-center gap-1 text-muted">
            <span className="h-2 w-2 rounded-sm bg-accent/50" /> Proposed
          </span>
          <span className="text-muted">· scroll timeline →</span>
        </div>
      </header>

      {hasPending && (
        <div className="shrink-0 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs text-accent-hover sm:px-6">
          Proposed replan is overlapping the current plan — confirm or discard in
          the side panel.
        </div>
      )}

      {/* Secondary: committed plan already past deadline — recovery chip, not always-on CTA */}
      {!hasPending &&
        !showAiReplan &&
        committedPastDeadline.length > 0 && (
          <div className="shrink-0 border-b border-warning/30 bg-warning/10">
            <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
              <div className="min-w-0 flex-1 overflow-x-auto">
                <div className="flex items-center gap-4">
                  {rippleWarnings
                    .filter((w) => w.includes("past delivery deadline"))
                    .map((w, i) => (
                      <p
                        key={i}
                        className="shrink-0 whitespace-nowrap text-xs text-warning"
                      >
                        ⚠ {w}
                      </p>
                    ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => openAiReplan(committedPastDeadline[0]!.id)}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent-hover hover:bg-accent/25"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Recovery options
                <span className="rounded-full bg-warning/90 px-1.5 py-0.5 text-[10px] font-bold text-background">
                  {committedPastDeadline.length}
                </span>
              </button>
            </div>
          </div>
        )}

      {infoMessage && (
        <div className="shrink-0 border-b border-border bg-surface-elevated px-4 py-2 text-sm text-muted">
          {infoMessage}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="inline-block min-w-max">
          <MaterialGateBar gates={gates} dates={dates} cellWidth={CELL_WIDTH} />
          <div className="sticky top-0 z-20 flex border-b border-border bg-surface">
            <div className="sticky left-0 z-30 w-56 shrink-0 border-r border-border bg-surface px-4 py-2 text-xs font-medium text-muted">
              Order / Stage
            </div>
            <div className="flex">
              {dates.map((d) => (
                <div
                  key={d}
                  className="shrink-0 border-r border-border-subtle px-1 py-2 text-center text-xs text-muted"
                  style={{ width: CELL_WIDTH }}
                >
                  {format(parseISO(d), "MMM d")}
                </div>
              ))}
            </div>
          </div>

          <div className="gantt-grid">
            {rows.map((row) => {
              const order = orders.find((o) => o.id === row.orderId);
              const style = styles.find((s) => s.id === order?.styleId);
              const line = lines.find((l) => l.id === row.lineId);
              return (
                <div
                  key={`${row.orderId}:${row.stage}:${row.lineId}`}
                  className="flex"
                >
                  <div
                    className="sticky left-0 z-10 flex w-56 shrink-0 items-center gap-2 border-r border-b border-border bg-surface px-3"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: STAGE_COLORS[row.stage] }}
                    />
                    <div className="min-w-0 truncate">
                      <p className="truncate text-xs font-medium">
                        {order?.orderNumber}
                      </p>
                      <p className="truncate text-[10px] text-muted">
                        {STAGE_LABELS[row.stage]}
                        {line ? ` · ${line.name}` : ""} · {style?.code}
                      </p>
                    </div>
                  </div>
                  <div className="flex">
                    {dates.map((d) => {
                      const key = `${row.orderId}:${row.stage}:${row.lineId}:${d}`;
                      const cell = cellMap.get(key);
                      const pending = pendingMap.get(key);
                      if (!cell && !pending) {
                        return (
                          <div
                            key={d}
                            className="shrink-0 border-r border-b border-border-subtle"
                            style={{
                              width: CELL_WIDTH,
                              height: ROW_HEIGHT,
                            }}
                          />
                        );
                      }
                      return (
                        <ScheduleCellView
                          key={d}
                          cell={cell}
                          pending={pending}
                          previewMode={hasPending}
                          isSelected={
                            !!cell && isSameCell(selectedCell, cell)
                          }
                          onClick={() =>
                            cell ? handleCellClick(cell) : undefined
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Fixed slide-over — stays open through preview → confirm */}
      <AnimatePresence>
        {selectedCell && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40"
              onClick={hasPending ? undefined : handleClosePanel}
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl"
            >
              <RippleEditor
                cell={selectedCell}
                order={orders.find((o) => o.id === selectedCell.orderId)}
                style={styles.find(
                  (s) =>
                    s.id ===
                    orders.find((o) => o.id === selectedCell.orderId)?.styleId
                )}
                value={editValue}
                onChange={setEditValue}
                onPreview={handleRipplePreview}
                onConfirm={handleConfirmPlan}
                onTryAiReplan={handleTryAiReplan}
                onDiscard={handleDiscardPlan}
                onClose={handleClosePanel}
                hasPending={hasPending}
                isPreviewing={isPreviewing}
                pendingWarnings={pendingWarnings}
                showTryAi={pendingNeedsAi}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* AI Replan — only on explicit button click */}
      <AnimatePresence>
        {showAiReplan && aiReplanOrderId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setShowAiReplan(false)}
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-surface shadow-2xl"
            >
              {committedPastDeadline.length > 1 && (
                <div className="border-b border-border p-4">
                  <label className="text-xs text-muted">
                    Order past delivery
                  </label>
                  <select
                    value={aiReplanOrderId}
                    onChange={(e) => setAiReplanOrderId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {committedPastDeadline.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.orderNumber}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <CopilotPanel
                orderId={aiReplanOrderId}
                onClose={() => setShowAiReplan(false)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function isSameCell(a: ScheduleCell | null, b: ScheduleCell): boolean {
  if (!a) return false;
  return (
    a.orderId === b.orderId &&
    a.stage === b.stage &&
    a.lineId === b.lineId &&
    a.date === b.date
  );
}

function cellQty(c: ScheduleCell) {
  return c.actualQty ?? c.plannedQty;
}

function ScheduleCellView({
  cell,
  pending,
  previewMode,
  isSelected,
  onClick,
}: {
  cell?: ScheduleCell;
  pending?: ScheduleCell;
  previewMode: boolean;
  isSelected: boolean;
  onClick?: () => void;
}) {
  const base = cell ?? pending!;
  const color = STAGE_COLORS[base.stage];
  const currentQty = cell ? cellQty(cell) : null;
  const proposedQty = pending ? cellQty(pending) : null;

  // Compare by qty/existence only — status flips (planned→projected) are not visual diffs
  type Diff = "normal" | "unchanged" | "qty_change" | "removed" | "added";
  let diff: Diff = "normal";
  if (previewMode) {
    if (cell && pending) {
      diff = currentQty === proposedQty ? "unchanged" : "qty_change";
    } else if (cell && !pending) {
      diff = "removed";
    } else if (!cell && pending) {
      diff = "added";
    }
  }

  const title =
    diff === "qty_change"
      ? `Current ${currentQty} → Proposed ${proposedQty}`
      : diff === "removed"
        ? `Removed from plan (was ${currentQty})`
        : diff === "added"
          ? `Added to plan (${proposedQty})`
          : "Click to edit actual output";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "group relative shrink-0 border-r border-b border-border-subtle transition-all",
        onClick ? "cursor-pointer" : "cursor-default",
        isSelected && "z-10 ring-2 ring-accent ring-inset"
      )}
      style={{ width: CELL_WIDTH, height: ROW_HEIGHT }}
      title={title}
    >
      {/* Normal / unchanged committed look */}
      {(diff === "normal" || diff === "unchanged") && (cell || pending) && (
        <div
          className="absolute inset-1 flex flex-col items-center justify-center rounded-md text-[10px] font-medium"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} ${(cell ?? pending)!.status === "projected" ? 15 : 30}%, transparent)`,
            borderLeft: `3px solid ${color}`,
          }}
        >
          <span className="text-foreground">
            {proposedQty ?? currentQty}
          </span>
          {(cell ?? pending)!.locked && (
            <Lock className="absolute right-1 top-1 h-2.5 w-2.5 text-muted" />
          )}
        </div>
      )}

      {/* Removed from proposed plan — dashed ghost only */}
      {diff === "removed" && cell && (
        <div
          className="absolute inset-1 flex flex-col items-center justify-center rounded-md text-[10px] font-medium"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
            border: `1.5px dashed ${color}`,
            opacity: 0.7,
          }}
        >
          <span className="text-muted line-through">{currentQty}</span>
          <span className="text-[8px] text-muted">old</span>
        </div>
      )}

      {/* Added in proposed plan — solid new */}
      {diff === "added" && pending && (
        <div
          className="absolute inset-1 flex flex-col items-center justify-center rounded-md text-[10px] font-semibold"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 45%, transparent)`,
            borderLeft: `3px solid ${color}`,
            boxShadow:
              "0 0 0 1px color-mix(in srgb, var(--color-accent) 55%, transparent)",
          }}
        >
          <span className="text-foreground">{proposedQty}</span>
          <span className="text-[8px] font-bold text-accent-hover">new</span>
        </div>
      )}

      {/* Qty changed on same day — ghost old + solid new stacked */}
      {diff === "qty_change" && cell && pending && (
        <>
          <div
            className="absolute inset-1 rounded-md"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`,
              border: `1.5px dashed ${color}`,
            }}
          />
          <div className="absolute inset-1 z-[1] flex flex-col items-stretch justify-between p-0.5">
            <div className="flex items-center justify-center gap-0.5 text-[9px] leading-none text-muted">
              <span className="line-through">{currentQty}</span>
              <span className="text-[7px]">old</span>
            </div>
            <div
              className="flex flex-1 items-center justify-center rounded-sm text-[10px] font-semibold"
              style={{
                backgroundColor: `color-mix(in srgb, ${color} 50%, transparent)`,
                boxShadow:
                  "0 0 0 1px color-mix(in srgb, var(--color-accent) 55%, transparent)",
              }}
            >
              <span className="text-foreground">{proposedQty}</span>
              <span className="ml-0.5 text-[7px] font-bold text-accent-hover">
                new
              </span>
            </div>
          </div>
          {pending.locked && (
            <Lock className="absolute right-1 top-1 z-[2] h-2.5 w-2.5 text-foreground" />
          )}
        </>
      )}

      {!previewMode && (
        <Pencil className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 text-muted opacity-0 group-hover:opacity-100" />
      )}
    </button>
  );
}

function RippleEditor({
  cell,
  order,
  style,
  value,
  onChange,
  onPreview,
  onConfirm,
  onTryAiReplan,
  onDiscard,
  onClose,
  hasPending,
  isPreviewing,
  pendingWarnings,
  showTryAi,
}: {
  cell: ScheduleCell;
  order?: { orderNumber: string; deliveryDeadline: string };
  style?: { code: string; name: string };
  value: string;
  onChange: (v: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onTryAiReplan: () => void;
  onDiscard: () => void;
  onClose: () => void;
  hasPending: boolean;
  isPreviewing: boolean;
  pendingWarnings: string[];
  showTryAi: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const variance = parseInt(value, 10) - cell.plannedQty;

  useEffect(() => {
    if (hasPending) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [cell, hasPending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onPreview();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="border-b border-border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">
          {hasPending ? "Confirm Replan" : "Ripple Edit"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-4 space-y-1 text-sm">
        <p>
          <span className="text-muted">Order:</span> {order?.orderNumber}
        </p>
        <p>
          <span className="text-muted">Stage:</span> {STAGE_LABELS[cell.stage]}
        </p>
        <p>
          <span className="text-muted">Date:</span>{" "}
          {format(parseISO(cell.date), "EEEE, MMM d")}
        </p>
        <p>
          <span className="text-muted">Style:</span> {style?.code} — {style?.name}
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-border-subtle bg-surface-elevated p-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Planned</span>
          <span className="font-mono">{cell.plannedQty} pcs</span>
        </div>
        <div className="mt-2">
          <label className="text-xs text-muted">Actual Output</label>
          <input
            ref={inputRef}
            type="number"
            min={0}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={hasPending || isPreviewing}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-lg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
          />
        </div>
        {!isNaN(variance) && variance !== 0 && (
          <p
            className={cn(
              "mt-2 text-xs font-medium",
              variance < 0 ? "text-danger" : "text-success"
            )}
          >
            {variance > 0 ? "+" : ""}
            {variance} pcs vs plan — will cascade downstream
          </p>
        )}
      </div>

      {hasPending ? (
        <>
          {pendingWarnings.length > 0 && (
            <div className="mb-4 space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-3">
              {pendingWarnings.map((w, i) => (
                <p key={i} className="text-xs text-warning">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}
          <p className="mb-3 text-xs text-muted">
            Proposed plan is shown overlapping the current plan on the Gantt.
            Confirm to lock in, or discard to keep the current schedule.
          </p>
          <div className="flex flex-col gap-2">
            {showTryAi && (
              <button
                type="button"
                onClick={onTryAiReplan}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
              >
                <Sparkles className="h-4 w-4" />
                Try AI Replan
              </button>
            )}
            <button
              type="button"
              onClick={onConfirm}
              className={cn(
                "w-full rounded-lg py-2.5 text-sm font-medium",
                showTryAi
                  ? "border border-border text-foreground hover:bg-surface-elevated"
                  : "bg-accent text-white hover:bg-accent-hover"
              )}
            >
              {showTryAi ? "Confirm without AI" : "Confirm Plan"}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="w-full rounded-lg border border-border py-2.5 text-sm font-medium text-muted hover:bg-surface-elevated hover:text-foreground"
            >
              Discard Preview
            </button>
          </div>
          {showTryAi && (
            <p className="mt-3 text-xs text-muted">
              Cascade alone still misses delivery — AI suggests overtime, line
              split, or sequence swap. Confirms this plan first, then opens
              recovery options.
            </p>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onPreview}
            disabled={isPreviewing}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {isPreviewing ? "Calculating…" : "Lock & Auto Replan"}
          </button>
          <p className="mt-3 text-xs text-muted">
            Preview the cascaded plan overlapping the current schedule — nothing
            is saved until you confirm.
          </p>
        </>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
