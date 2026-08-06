"use client";

import { format, parseISO } from "date-fns";
import type { MaterialGate } from "@/lib/types";

interface Props {
  gates: MaterialGate[];
  dates: string[];
  cellWidth: number;
  labelWidth?: number;
}

export function MaterialGateBar({
  gates,
  dates,
  cellWidth,
  labelWidth = 224,
}: Props) {
  if (dates.length === 0) return null;

  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const timelineWidth = dates.length * cellWidth;

  // Stagger labels when multiple gates land on nearby columns
  const visible = gates
    .map((gate) => {
      const idx = dateIndex.get(gate.rmInHouseDate);
      return idx === undefined ? null : { gate, idx };
    })
    .filter((g): g is { gate: MaterialGate; idx: number } => g !== null);

  return (
    <div
      className="flex border-b border-warning/25 bg-warning/5"
      style={{ width: labelWidth + timelineWidth, height: 44 }}
    >
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center border-r border-border bg-surface px-3 text-[11px] font-medium text-warning"
        style={{ width: labelWidth }}
      >
        Material Gates
      </div>
      <div className="relative shrink-0" style={{ width: timelineWidth, height: 44 }}>
        {visible.map(({ gate, idx }, i) => {
          const top = i % 2 === 0 ? 4 : 22;
          return (
            <div
              key={gate.orderId}
              className="absolute flex flex-col items-center"
              style={{
                left: idx * cellWidth,
                width: cellWidth,
                top,
              }}
              title={`${gate.orderNumber} · RM in-house ${format(parseISO(gate.rmInHouseDate), "MMM d, yyyy")}${gate.blocked ? " · blocked" : ""}`}
            >
              <div className="absolute -top-4 bottom-0 left-1/2 w-0.5 -translate-x-1/2 bg-warning/60" />
              <span
                className={`relative z-10 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight shadow-sm ${
                  gate.blocked
                    ? "bg-danger text-white"
                    : "bg-warning text-background"
                }`}
              >
                {format(parseISO(gate.rmInHouseDate), "MMM d")} ·{" "}
                {gate.orderNumber.split("-").pop()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
