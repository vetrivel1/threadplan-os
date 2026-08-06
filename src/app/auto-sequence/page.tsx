"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  Package,
  TrendingUp,
  Zap,
  Sparkles,
} from "lucide-react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { PlanningSequence } from "@/components/dashboard/PlanningSequence";

export default function AutoSequencePage() {
  const { orders, cells, lastSequenceRun } = useScheduleStore();
  const mounted = useHydrated();

  const stats = useMemo(() => {
    const delayed = orders.filter((o) => o.status === "delayed").length;
    const atRisk = orders.filter((o) => o.status === "at_risk").length;
    const locked = cells.filter((c) => c.locked).length;
    const totalPlanned = cells.reduce((s, c) => s + c.plannedQty, 0);
    return { delayed, atRisk, locked, totalPlanned, erpOrders: orders.length };
  }, [orders, cells]);

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
