"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { ArrowRight, Lock, Plus } from "lucide-react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import { STAGE_LABELS, PACKING_DRAG } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErpSyncBanner } from "@/components/dashboard/PlanningFlow";
import { SimulateOrderModal } from "@/components/orders/SimulateOrderModal";

const STATUS_STYLES: Record<string, string> = {
  planned: "bg-muted/20 text-muted",
  in_progress: "bg-accent/20 text-accent-hover",
  at_risk: "bg-warning/20 text-warning",
  delayed: "bg-danger/20 text-danger",
  completed: "bg-success/20 text-success",
};

export default function OrdersPage() {
  const { orders, styles } = useScheduleStore();
  const [simulateOpen, setSimulateOpen] = useState(false);

  return (
    <div className="p-8">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Orders from ERP</h1>
          <span className="flex items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-0.5 text-xs text-muted">
            <Lock className="h-3 w-3" />
            Read-only
          </span>
        </div>
        <p className="mt-1 text-muted">
          Production orders synced from ERP — style, quantity, RM in-house date,
          delivery deadline &amp; packing type. ThreadPlan auto-sequences these into
          a capacity plan.
        </p>
      </header>

      <div className="mb-6">
        <ErpSyncBanner />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          {orders.length} orders received · auto-sequence runs on each new arrival
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSimulateOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Simulate ERP Order
          </button>
          <Link
            href="/auto-sequence"
            className="flex items-center gap-1 text-sm text-accent hover:text-accent-hover"
          >
            View auto-sequence <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-elevated text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">ERP Order</th>
              <th className="px-4 py-3 font-medium">Style</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Packing</th>
              <th className="px-4 py-3 font-medium">RM In-House</th>
              <th className="px-4 py-3 font-medium">Deadline</th>
              <th className="px-4 py-3 font-medium">ERP Priority</th>
              <th className="px-4 py-3 font-medium">Plan Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const style = styles.find((s) => s.id === order.styleId);
              return (
                <tr
                  key={order.id}
                  className="border-b border-border-subtle hover:bg-surface-elevated/50"
                >
                  <td className="px-4 py-3 font-medium">{order.orderNumber}</td>
                  <td className="px-4 py-3">
                    <div>
                      <p>{style?.code}</p>
                      <p className="text-xs text-muted">{style?.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {order.quantity.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize">{order.packingType}</span>
                    {order.packingType === "assorted" && (
                      <span className="ml-1 text-xs text-warning">
                        ({PACKING_DRAG.assorted}× drag)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {format(parseISO(order.rmInHouseDate), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3">
                    {format(parseISO(order.deliveryDeadline), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 font-mono">{order.priority}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                        STATUS_STYLES[order.status]
                      )}
                    >
                      {order.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-8">
        <h2 className="mb-1 font-semibold">Style Master (from ERP)</h2>
        <p className="mb-4 text-sm text-muted">
          SMV and complexity per style — used by the auto-sequence engine to
          calculate daily line capacity and learning curve ramp.
        </p>
        <div className="grid grid-cols-2 gap-6">
          {styles.map((style) => (
            <div
              key={style.id}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <h3 className="font-semibold">
                {style.code} — {style.name}
              </h3>
              <p className="text-sm text-muted">
                Complexity: {style.complexity}×
              </p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {(["knitting", "cutting", "sewing", "packing"] as const).map(
                  (stage) => (
                    <div
                      key={stage}
                      className="rounded-lg bg-surface-elevated px-2 py-2 text-center"
                    >
                      <p className="text-[10px] text-muted">
                        {STAGE_LABELS[stage]}
                      </p>
                      <p className="font-mono text-sm">{style.smv[stage]}</p>
                      <p className="text-[9px] text-muted">SMV</p>
                    </div>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <SimulateOrderModal
        open={simulateOpen}
        onClose={() => setSimulateOpen(false)}
      />
    </div>
  );
}
