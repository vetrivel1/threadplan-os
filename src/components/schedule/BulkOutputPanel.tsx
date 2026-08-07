"use client";

import { useMemo, useState } from "react";
import { differenceInCalendarDays, differenceInDays, format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import { STAGE_LABELS, type RippleEdit } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BatchBriefing } from "@/lib/ai/briefing";

interface Props {
  onClose: () => void;
}

interface Row {
  cellId: string;
  orderId: string;
  lineId: string;
  stage: RippleEdit["stage"];
  date: string;
  orderNumber: string;
  styleCode: string;
  lineName: string;
  plannedQty: number;
}

type Stage = "collect" | "reviewing" | "briefing";

/**
 * The end-of-day counterpart to the per-cell RippleEditor: one figure per
 * active line instead of one Gantt cell at a time, replanned in a single
 * batch. This is the primary daily workflow the problem statement describes
 * ("the single recurring manual entry is daily output by style by line,
 * refreshed end of day") — the per-cell editor remains for one-off
 * corrections, not the everyday path.
 */
export function BulkOutputPanel({ onClose }: Props) {
  const {
    orders,
    styles,
    lines,
    cells,
    previewBulkOutput,
    confirmBulkEdit,
    discardRippleEdit,
    pendingCells,
    pendingOrders,
    pendingEdits,
    isConfirming,
  } = useScheduleStore();

  const [stage, setStage] = useState<Stage>("collect");
  const [values, setValues] = useState<Record<string, string>>({});
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [briefing, setBriefing] = useState<BatchBriefing | null>(null);
  const [isBriefing, setIsBriefing] = useState(false);

  /** The earliest day still awaiting an output report — one report per active line. */
  const targetDate = useMemo(() => {
    let earliest: string | undefined;
    for (const c of cells) {
      if (c.actualQty != null) continue;
      if (!earliest || c.date < earliest) earliest = c.date;
    }
    return earliest;
  }, [cells]);

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  /**
   * `targetDate` is whichever day is earliest across the whole plan, not
   * necessarily today — e.g. if the highest-priority order's material isn't
   * in-house yet, the floor can be genuinely idle for several days. Label
   * the panel by that relationship instead of always claiming "today", so a
   * planner never sees a future date under a "Today's Output" heading.
   */
  const dateRelation = useMemo<"today" | "overdue" | "upcoming" | "none">(() => {
    if (!targetDate) return "none";
    if (targetDate === today) return "today";
    return targetDate < today ? "overdue" : "upcoming";
  }, [targetDate, today]);

  const dateGapDays = useMemo(() => {
    if (!targetDate) return 0;
    return Math.abs(differenceInCalendarDays(parseISO(targetDate), parseISO(today)));
  }, [targetDate, today]);

  const rows = useMemo<Row[]>(() => {
    if (!targetDate) return [];
    return cells
      .filter((c) => c.date === targetDate && c.actualQty == null)
      .map((c) => {
        const order = orders.find((o) => o.id === c.orderId);
        const style = styles.find((s) => s.id === order?.styleId);
        const line = lines.find((l) => l.id === c.lineId);
        return {
          cellId: c.id,
          orderId: c.orderId,
          lineId: c.lineId,
          stage: c.stage,
          date: c.date,
          orderNumber: order?.orderNumber ?? c.orderId,
          styleCode: style?.code ?? "—",
          lineName: line?.name ?? c.lineId,
          plannedQty: c.plannedQty,
        };
      })
      .sort((a, b) => a.lineName.localeCompare(b.lineName));
  }, [cells, targetDate, orders, styles, lines]);

  const valueFor = (row: Row) => values[row.cellId] ?? String(row.plannedQty);

  const totalVariance = useMemo(() => {
    return rows.reduce((sum, row) => {
      const v = parseInt(valueFor(row), 10);
      if (isNaN(v)) return sum;
      return sum + (v - row.plannedQty);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, values]);

  const atRisk = useMemo(() => {
    if (!pendingCells || !pendingOrders) return [];
    return pendingOrders
      .filter((o) => o.status === "delayed")
      .map((o) => {
        let latest: string | undefined;
        for (const c of pendingCells) {
          if (c.orderId !== o.id) continue;
          if (!latest || c.date > latest) latest = c.date;
        }
        const style = styles.find((s) => s.id === o.styleId);
        const daysLate = latest
          ? Math.max(0, differenceInDays(parseISO(latest), parseISO(o.deliveryDeadline)))
          : 0;
        return {
          orderNumber: o.orderNumber,
          styleCode: style?.code ?? "—",
          projectedCompletion: latest ?? "",
          deliveryDeadline: o.deliveryDeadline,
          daysLate,
        };
      });
  }, [pendingCells, pendingOrders, styles]);

  const handlePreview = async () => {
    const edits: RippleEdit[] = rows.map((row) => ({
      orderId: row.orderId,
      lineId: row.lineId,
      stage: row.stage,
      date: row.date,
      actualQty: (() => {
        const v = parseInt(valueFor(row), 10);
        return isNaN(v) || v < 0 ? row.plannedQty : v;
      })(),
    }));
    setIsPreviewing(true);
    try {
      await previewBulkOutput(edits);
      setStage("reviewing");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirm = async (withBriefing: boolean) => {
    await confirmBulkEdit();
    if (!withBriefing || atRisk.length === 0) {
      onClose();
      return;
    }
    setStage("briefing");
    setIsBriefing(true);
    try {
      const res = await fetch("/api/ai/batch-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editsCount: pendingEdits?.length ?? rows.length,
          linesReported: rows.length,
          totalVarianceUnits: totalVariance,
          warnings: [],
          atRisk,
          onTrackCount: Math.max(
            0,
            (pendingOrders?.length ?? 0) - atRisk.length
          ),
        }),
      });
      if (res.ok) {
        setBriefing(await res.json());
      }
    } catch {
      // Briefing is a bonus narration over an already-committed plan — a
      // failure here should never look like the batch itself failed.
    } finally {
      setIsBriefing(false);
    }
  };

  const handleDiscard = () => {
    discardRippleEdit();
    setStage("collect");
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-semibold">
              {dateRelation === "upcoming" ? "Record Output — Not Due Yet" : "Record Today's Output"}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {targetDate ? (
                <>
                  {format(parseISO(targetDate), "EEEE, MMM d")}
                  {dateRelation === "overdue" && (
                    <span className="text-danger">
                      {" "}
                      ({dateGapDays} day{dateGapDays === 1 ? "" : "s"} overdue)
                    </span>
                  )}
                  {dateRelation === "upcoming" && (
                    <span>
                      {" "}
                      — nothing due yet, next production starts in {dateGapDays} day
                      {dateGapDays === 1 ? "" : "s"}
                    </span>
                  )}
                  {" — one figure per active line, replanned once"}
                </>
              ) : (
                "No lines are awaiting an output report."
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              Every line is already reported for its next open date.
            </p>
          ) : stage === "collect" ? (
            <div className="space-y-2">
              {rows.map((row) => (
                <div
                  key={row.cellId}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.lineName}</p>
                    <p className="truncate text-xs text-muted">
                      {row.orderNumber} · {row.styleCode} · {STAGE_LABELS[row.stage]}
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    Plan <span className="font-mono">{row.plannedQty}</span>
                  </p>
                  <input
                    type="number"
                    min={0}
                    value={valueFor(row)}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [row.cellId]: e.target.value }))
                    }
                    className="w-24 rounded-lg border border-border bg-background px-2.5 py-1.5 text-right font-mono text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              ))}
            </div>
          ) : stage === "reviewing" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border-subtle bg-surface-elevated p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Lines reported</span>
                  <span className="font-mono">{rows.length}</span>
                </div>
                <div className="mt-1.5 flex justify-between text-sm">
                  <span className="text-muted">Net variance vs. plan</span>
                  <span
                    className={cn(
                      "font-mono font-medium",
                      totalVariance < 0
                        ? "text-danger"
                        : totalVariance > 0
                          ? "text-success"
                          : ""
                    )}
                  >
                    {totalVariance > 0 ? "+" : ""}
                    {totalVariance} pcs
                  </span>
                </div>
              </div>

              {atRisk.length > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-danger/30 bg-danger/10 p-3">
                  <p className="text-xs font-semibold text-danger">
                    {atRisk.length} order(s) now past delivery deadline
                  </p>
                  {atRisk.map((o) => (
                    <p key={o.orderNumber} className="text-xs text-danger">
                      {o.orderNumber} ({o.styleCode}) — {o.daysLate} day(s) late,
                      projected {o.projectedCompletion}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-success">
                  No orders moved past their delivery deadline.
                </p>
              )}

              <p className="text-xs text-muted">
                This recalculated cascade is overlapping the current plan on
                the Gantt. Confirm to record it, or discard to keep the
                current schedule.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {isBriefing ? (
                <div className="flex flex-col items-center py-8">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  >
                    <Sparkles className="h-8 w-8 text-accent" />
                  </motion.div>
                  <p className="mt-3 text-sm text-muted">
                    Summarizing today&apos;s batch…
                  </p>
                </div>
              ) : briefing ? (
                <>
                  <div className="rounded-lg border border-accent/20 bg-accent/5 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-hover">
                      <Sparkles className="h-3.5 w-3.5" />
                      End-of-day briefing
                    </p>
                    <p className="mt-2 text-sm leading-relaxed">{briefing.summary}</p>
                  </div>
                  {briefing.highlights.length > 0 && (
                    <ul className="space-y-1.5">
                      {briefing.highlights.map((h, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-xs leading-relaxed text-muted"
                        >
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Batch confirmed.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          {stage === "collect" && rows.length > 0 && (
            <button
              onClick={handlePreview}
              disabled={isPreviewing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {isPreviewing && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPreviewing ? "Calculating…" : "Preview Batch Cascade"}
            </button>
          )}
          {stage === "reviewing" && (
            <>
              {atRisk.length > 0 ? (
                <button
                  onClick={() => handleConfirm(true)}
                  disabled={isConfirming}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" />
                  Confirm &amp; Brief Me
                </button>
              ) : (
                <button
                  onClick={() => handleConfirm(false)}
                  disabled={isConfirming}
                  className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  Confirm Batch
                </button>
              )}
              {atRisk.length > 0 && (
                <button
                  onClick={() => handleConfirm(false)}
                  disabled={isConfirming}
                  className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-surface-elevated disabled:opacity-60"
                >
                  Confirm without AI
                </button>
              )}
              <button
                onClick={handleDiscard}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted hover:bg-surface-elevated hover:text-foreground"
              >
                Discard
              </button>
            </>
          )}
          {stage === "briefing" && (
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
