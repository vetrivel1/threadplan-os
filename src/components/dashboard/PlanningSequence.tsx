"use client";

import { useMemo } from "react";
import { format, parseISO, differenceInDays, isBefore, isAfter } from "date-fns";
import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import {
  dailyLineCapacity,
  getLearningEfficiency,
  complexityFactor,
} from "@/lib/engine/capacity";
import { sortOrdersBySequence } from "@/lib/engine/sequencing-policy";
import { PACKING_DRAG } from "@/lib/types";

function buildPlannerComment(item: {
  rank: number;
  order: { orderNumber: string; quantity: number; packingType: string; rmInHouseDate: string; deliveryDeadline: string; priority: number };
  style?: { name: string; code: string };
  firstCellDate?: string;
  daysToDeadline: number;
  sewingSmv: number;
  day1Eff: number;
  day1Cap: number;
  day5Cap: number;
  prevOrderNumber?: string;
  rmReady: boolean;
}): string {
  const parts: string[] = [];
  const rmDate = format(parseISO(item.order.rmInHouseDate), "MMM d");
  const dueDate = format(parseISO(item.order.deliveryDeadline), "MMM d");

  if (item.rank === 1) {
    parts.push(`Highest scheduling priority — earliest customer deadline (${dueDate}).`);
  } else {
    parts.push(`Queued after orders with sooner deadlines.`);
    if (item.prevOrderNumber) {
      parts.push(`Runs after ${item.prevOrderNumber} releases line capacity.`);
    }
  }

  if (!item.rmReady) {
    parts.push(`RM in-house gate on ${rmDate} — production cannot start before materials arrive.`);
  } else {
    parts.push(`RM already in-house — cleared to start immediately.`);
  }

  parts.push(
    `${item.style?.name} sewing SMV ${item.sewingSmv.toFixed(1)} min/pc; operators at ${Math.round(item.day1Eff * 100)}% efficiency on day 1 (~${item.day1Cap} pcs/d), ramping to ~${item.day5Cap} pcs/d by day 5.`
  );

  if (item.order.packingType === "assorted") {
    parts.push(`Assorted packing adds ${PACKING_DRAG.assorted}× cycle time at packing stage.`);
  }

  if (item.daysToDeadline <= 14 && !item.rmReady) {
    parts.push(`⚠ Tight window: only ${item.daysToDeadline}d to deadline once RM lands.`);
  }

  return parts.join(" ");
}

export function PlanningSequence() {
  const { orders, styles, lines, cells, learningCurves } = useScheduleStore();

  const sequence = useMemo(() => {
    const sewingLine = lines.find((l) => l.stage === "sewing");
    if (!sewingLine) return [];

    const sorted = sortOrdersBySequence(orders);

    const today = new Date();

    return sorted.map((order, index) => {
      const style = styles.find((s) => s.id === order.styleId);
      const firstCell = cells
        .filter((c) => c.orderId === order.id)
        .sort((a, b) => a.date.localeCompare(b.date))[0];

      const day1Eff = style
        ? getLearningEfficiency(learningCurves, style.id, 1)
        : 0;
      const day5Eff = style
        ? getLearningEfficiency(learningCurves, style.id, 5)
        : 0;

      const sewingSmv = style
        ? style.smv.sewing * complexityFactor(style.complexity)
        : 0;

      const day1Cap = style
        ? dailyLineCapacity(
            sewingLine.operators,
            sewingLine.shiftMinutes,
            sewingSmv,
            day1Eff * sewingLine.efficiencyBaseline,
            order.packingType,
            "sewing"
          )
        : 0;

      const day5Cap = style
        ? dailyLineCapacity(
            sewingLine.operators,
            sewingLine.shiftMinutes,
            sewingSmv,
            day5Eff * sewingLine.efficiencyBaseline,
            order.packingType,
            "sewing"
          )
        : 0;

      const rmReady = !isAfter(parseISO(order.rmInHouseDate), today);
      const rmBlocksStart =
        firstCell &&
        isBefore(parseISO(firstCell.date), parseISO(order.rmInHouseDate));

      const plannerComment = buildPlannerComment({
        rank: index + 1,
        order,
        style,
        firstCellDate: firstCell?.date,
        daysToDeadline: differenceInDays(
          parseISO(order.deliveryDeadline),
          today
        ),
        sewingSmv,
        day1Eff,
        day1Cap,
        day5Cap,
        prevOrderNumber: sorted[index - 1]?.orderNumber,
        rmReady,
      });

      return {
        rank: index + 1,
        order,
        style,
        firstCellDate: firstCell?.date,
        daysToDeadline: differenceInDays(
          parseISO(order.deliveryDeadline),
          today
        ),
        sewingSmv,
        day1Eff,
        day5Eff,
        day1Cap,
        day5Cap,
        plannerComment,
        rmReady,
        rmBlocksStart,
      };
    });
  }, [orders, styles, lines, cells, learningCurves]);

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Auto-Sequence Plan</h2>
          <p className="text-xs text-muted">
            Generated when ERP orders land — sequenced by deadline, RM gates, SMV &amp; learning curves
          </p>
        </div>
        <Link
          href="/schedule"
          className="flex items-center gap-1 text-sm text-accent hover:text-accent-hover"
        >
          Open Auto Plan <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="space-y-3">
        {sequence.map((item) => (
          <div
            key={item.order.id}
            className="rounded-lg border border-border-subtle bg-surface-elevated p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                  {item.rank}
                </span>
                <div>
                  <p className="font-medium">{item.order.orderNumber}</p>
                  <p className="text-sm text-muted">
                    {item.style?.name} ({item.style?.code}) ·{" "}
                    {item.order.quantity.toLocaleString()} pcs
                  </p>
                </div>
              </div>
              <div className="text-right text-xs">
                <p className="font-medium">
                  Due {format(parseISO(item.order.deliveryDeadline), "MMM d")}
                  <span className="ml-1 text-muted">
                    ({item.daysToDeadline}d)
                  </span>
                </p>
                <p className={item.rmReady ? "text-success" : "text-warning"}>
                  RM: {format(parseISO(item.order.rmInHouseDate), "MMM d")}
                  {item.rmReady ? " ✓" : " (pending)"}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[10px]">
              <Metric
                label="Sewing SMV"
                value={item.sewingSmv.toFixed(1)}
                hint="min/pc"
              />
              <Metric
                label="Day-1 Eff."
                value={`${Math.round(item.day1Eff * 100)}%`}
                hint={`→ ${item.day1Cap} pcs/d`}
              />
              <Metric
                label="Day-5 Eff."
                value={`${Math.round(item.day5Eff * 100)}%`}
                hint={`→ ${item.day5Cap} pcs/d`}
              />
              <Metric
                label="Plan Start"
                value={
                  item.firstCellDate
                    ? format(parseISO(item.firstCellDate), "MMM d")
                    : "—"
                }
                hint={item.rmReady ? "RM cleared" : "after RM gate"}
              />
            </div>

            <div className="mt-3 flex gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2.5">
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <p className="text-xs leading-relaxed text-muted">
                {item.plannerComment}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md bg-background px-2 py-1.5">
      <p className="text-muted">{label}</p>
      <p className="font-mono text-sm font-medium text-foreground">{value}</p>
      <p className="text-[9px] text-muted">{hint}</p>
    </div>
  );
}
