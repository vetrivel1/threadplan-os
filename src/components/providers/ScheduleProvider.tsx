"use client";

import { useEffect } from "react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { mapCell } from "@/lib/data/mappers";
import type { DbCell } from "@/lib/data/mappers";

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const hydrate = useScheduleStore((s) => s.hydrate);
  const setCells = useScheduleStore((s) => s.setCells);
  const organizationId = useScheduleStore((s) => s.organizationId);

  useEffect(() => {
    hydrate().then(() => {
      const { lastSequenceRun } = useScheduleStore.getState();
      if (!lastSequenceRun) {
        useScheduleStore.setState({
          lastSequenceRun: new Date().toISOString(),
        });
      }
    });
  }, [hydrate]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !organizationId) return;

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel("schedule_cells_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "schedule_cells",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;

          // Don't shift the baseline while a replan preview is overlaid on it —
          // the planner is comparing against the plan they previewed.
          if (useScheduleStore.getState().pendingEdit) return;

          const row = payload.new as DbCell;
          const cell = mapCell(row);

          setCells((prev) => {
            const idx = prev.findIndex(
              (c) =>
                c.orderId === cell.orderId &&
                c.stage === cell.stage &&
                c.lineId === cell.lineId &&
                c.date === cell.date
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = cell;
              return next;
            }
            return [...prev, cell].sort((a, b) => a.date.localeCompare(b.date));
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, setCells]);

  return <>{children}</>;
}
