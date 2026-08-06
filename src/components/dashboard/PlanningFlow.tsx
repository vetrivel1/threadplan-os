"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    step: 1,
    label: "Orders from ERP",
    short: "ERP",
    href: "/orders",
    activeOn: ["/orders"],
  },
  {
    step: 2,
    label: "Auto-Sequence",
    short: "Sequence",
    href: "/auto-sequence",
    activeOn: ["/auto-sequence"],
  },
  {
    step: 3,
    label: "Auto Plan",
    short: "Plan",
    href: "/schedule",
    activeOn: ["/schedule"],
  },
];

export function PlanningFlow({ currentPath }: { currentPath: string }) {
  return (
    <div className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur-sm">
      <div className="px-4 py-2">
        <div className="grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => (
            <div key={s.step} className="flex items-center gap-1">
              <Link
                href={s.href}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 transition-all sm:px-3",
                  s.activeOn.includes(currentPath)
                    ? "bg-accent/15 text-accent-hover ring-1 ring-accent/25"
                    : "text-muted hover:bg-surface-elevated hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold sm:h-7 sm:w-7 sm:text-xs",
                    s.activeOn.includes(currentPath)
                      ? "bg-accent text-white"
                      : "bg-surface-elevated text-muted"
                  )}
                >
                  {s.step}
                </span>
                <span className="truncate text-xs font-medium sm:text-sm">
                  <span className="sm:hidden">{s.short}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </span>
              </Link>
              {i < STEPS.length - 1 && (
                <ArrowRight className="hidden h-3 w-3 shrink-0 text-border md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ErpSyncBanner() {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-surface-elevated px-5 py-3">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 text-success" />
        <div>
          <p className="text-sm font-medium">ERP Sync Active</p>
          <p className="text-xs text-muted">
            Orders sync automatically — simulate a new ERP arrival below to
            trigger auto-sequence
          </p>
        </div>
      </div>
      <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
        Auto-sequence on sync
      </span>
    </div>
  );
}
