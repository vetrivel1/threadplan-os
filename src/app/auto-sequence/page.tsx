"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  GitBranch,
  Package,
  TrendingUp,
  Zap,
  Sparkles,
} from "lucide-react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { PlanningSequence } from "@/components/dashboard/PlanningSequence";
import { computeCriticalPaths } from "@/lib/engine/critical-path";
import { suggestMaterialDates } from "@/lib/engine/material-suggestion";

export default function AutoSequencePage() {
  const { orders, styles, lines, cells, lastSequenceRun } = useScheduleStore();
  const mounted = useHydrated();

  const stats = useMemo(() => {
    const delayed = orders.filter((o) => o.status === "delayed").length;
    const atRisk = orders.filter((o) => o.status === "at_risk").length;
    const locked = cells.filter((c) => c.locked).length;
    const totalPlanned = cells.reduce((s, c) => s + c.plannedQty, 0);
    return { delayed, atRisk, locked, totalPlanned, erpOrders: orders.length };
  }, [orders, cells]);

  const orderById = useMemo(
    () => new Map(orders.map((o) => [o.id, o])),
    [orders]
  );

  /** The two "Beyond the rules" outputs cheap enough to compute here without
   * re-running the optimizer — cutoff warning needs the winning sequence and
   * assignment strategy from a fresh optimize() and stays exclusive to the
   * full breakdown on Planning Rules. */
  const insights = useMemo(() => {
    if (!mounted) return null;
    const today = format(new Date(), "yyyy-MM-dd");

    const zeroSlack = computeCriticalPaths({ orders, styles, cells }).filter(
      (cp) => cp.route.length > 0 && cp.criticalChain.length === cp.route.length
    );

    const materialSuggestions = suggestMaterialDates({
      orders,
      styles,
      lines,
      today,
    }).filter((s) => orderById.has(s.orderId));
    const mostUrgentMaterial = materialSuggestions.length
      ? materialSuggestions.reduce((a, b) =>
          b.daysUntilNeeded < a.daysUntilNeeded ? b : a
        )
      : null;

    return { zeroSlack, mostUrgentMaterial };
  }, [mounted, orders, styles, lines, cells, orderById]);

  return (
    <div className="p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Auto-Sequence</h1>
        <p className="mt-1 text-muted">
          Runs automatically when ERP orders arrive — ranked by deadline, RM
          gates, SMV &amp; learning curves
        </p>
        {mounted && lastSequenceRun && (
          <p className="mt-1 text-xs text-muted" suppressHydrationWarning>
            Last run: {format(new Date(lastSequenceRun), "MMM d, h:mm a")}
          </p>
        )}
      </header>

      <div className="mb-8 grid grid-cols-4 gap-4">
        <StatCard
          icon={Package}
          label="ERP Orders"
          value={stats.erpOrders}
          accent="text-accent"
        />
        <StatCard
          icon={TrendingUp}
          label="Planned Output"
          value={stats.totalPlanned.toLocaleString()}
          suffix="pcs"
          accent="text-cutting"
        />
        <StatCard
          icon={AlertTriangle}
          label="At Risk / Delayed"
          value={`${stats.atRisk + stats.delayed}`}
          accent="text-warning"
        />
        <StatCard
          icon={Zap}
          label="Actuals Locked"
          value={stats.locked}
          accent="text-sewing"
        />
      </div>

      <PlanningSequence />

      {insights &&
        (insights.zeroSlack.length > 0 || insights.mostUrgentMaterial) && (
          <div className="mt-6 rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                Before you open Auto Plan
              </h3>
              <Link
                href="/engine"
                className="flex shrink-0 items-center gap-1 text-xs text-accent hover:text-accent-hover"
              >
                Full detail on Planning Rules
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="mt-3 space-y-2.5">
              {insights.zeroSlack.length > 0 && (
                <div className="flex items-start gap-2 text-sm">
                  <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p className="text-muted">
                    <strong className="text-foreground">
                      {insights.zeroSlack.length} order
                      {insights.zeroSlack.length === 1 ? "" : "s"}
                    </strong>{" "}
                    {insights.zeroSlack.length === 1 ? "has" : "have"} zero
                    slack anywhere in{" "}
                    {insights.zeroSlack.length === 1 ? "its" : "their"} route
                    (
                    {insights.zeroSlack
                      .slice(0, 3)
                      .map(
                        (cp) =>
                          orderById.get(cp.orderId)?.orderNumber ?? cp.orderId
                      )
                      .join(", ")}
                    {insights.zeroSlack.length > 3
                      ? ` +${insights.zeroSlack.length - 3} more`
                      : ""}
                    ) — any delay on the floor pushes the delivery date
                    directly, with nothing upstream to absorb it.
                  </p>
                </div>
              )}
              {insights.mostUrgentMaterial && (
                <div className="flex items-start gap-2 text-sm">
                  <Package className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p className="text-muted">
                    Most urgent material to chase:{" "}
                    <strong className="text-foreground">
                      {orderById.get(insights.mostUrgentMaterial.orderId)
                        ?.orderNumber ?? insights.mostUrgentMaterial.orderId}
                    </strong>{" "}
                    needs its material in-house by{" "}
                    <strong className="text-foreground">
                      {insights.mostUrgentMaterial.suggestedInHouseDate}
                    </strong>{" "}
                    —{" "}
                    {insights.mostUrgentMaterial.daysUntilNeeded < 0
                      ? `${Math.abs(insights.mostUrgentMaterial.daysUntilNeeded)} day${Math.abs(insights.mostUrgentMaterial.daysUntilNeeded) === 1 ? "" : "s"} overdue`
                      : `${insights.mostUrgentMaterial.daysUntilNeeded} day${insights.mostUrgentMaterial.daysUntilNeeded === 1 ? "" : "s"} from now`}
                    , to hit its delivery deadline.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

      <div className="mt-6 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <p className="font-medium text-accent-hover">
              Next: Open Auto Plan to execute &amp; replan
            </p>
            <p className="mt-1 text-sm text-muted">
              Lock daily actuals to preview the cascade. If delivery is still at
              risk, use Try AI Replan for recovery options.
            </p>
          </div>
        </div>
        <Link
          href="/schedule"
          className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Open Auto Plan →
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  suffix?: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-2 text-muted">
        <Icon className={`h-4 w-4 ${accent}`} />
        <span className="text-sm">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">
        {value}
        {suffix && (
          <span className="ml-1 text-sm font-normal text-muted">{suffix}</span>
        )}
      </p>
    </div>
  );
}
