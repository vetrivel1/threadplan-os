"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInDays, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { Sparkles, X, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import type { RecoveryOption } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  orderId: string;
  onClose: () => void;
}

export function CopilotPanel({ orderId, onClose }: Props) {
  const {
    orders,
    cells,
    styles,
    aiRecommendation,
    isAiLoading,
    setAiRecommendation,
    setAiLoading,
    rippleWarnings,
    appliedRecovery,
    applyRecovery,
  } = useScheduleStore();

  const order = orders.find((o) => o.id === orderId);
  const style = styles.find((s) => s.id === order?.styleId);

  const deliveryDeadline = order?.deliveryDeadline;
  const hasStyle = !!style;

  // Derive stable primitives so the effect does not re-fire on every store
  // update — `cells` and `orders` get new array identities constantly.
  const projectedCompletion = useMemo(() => {
    let latest: string | undefined;
    for (const c of cells) {
      if (c.orderId !== orderId) continue;
      if (!latest || c.date > latest) latest = c.date;
    }
    return latest;
  }, [cells, orderId]);

  const warningsKey = rippleWarnings.join("|");

  useEffect(() => {
    if (!deliveryDeadline || !hasStyle) return;

    const controller = new AbortController();

    const fetchRec = async () => {
      setAiLoading(true);
      try {
        const daysLate = projectedCompletion
          ? Math.max(
              0,
              differenceInDays(
                parseISO(projectedCompletion),
                parseISO(deliveryDeadline)
              )
            )
          : 0;

        const res = await fetch("/api/ai/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            orderId,
            daysLate,
            projectedCompletion,
            warnings: warningsKey ? warningsKey.split("|") : [],
          }),
        });
        if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
        const data = await res.json();
        if (!controller.signal.aborted) setAiRecommendation(data);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setAiRecommendation(null);
      } finally {
        if (!controller.signal.aborted) setAiLoading(false);
      }
    };

    fetchRec();

    return () => controller.abort();
  }, [
    orderId,
    deliveryDeadline,
    hasStyle,
    projectedCompletion,
    warningsKey,
    setAiLoading,
    setAiRecommendation,
  ]);

  if (!order || !style) return null;

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" />
          <h3 className="font-semibold">AI Co-Pilot</h3>
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {appliedRecovery && appliedRecovery.length > 0 && (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Applied to the plan
          </p>
          <ul className="mt-1.5 space-y-1">
            {appliedRecovery.map((note, i) => (
              <li key={i} className="text-xs leading-relaxed text-muted">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAiLoading ? (
        <div className="flex flex-col items-center py-8">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          >
            <Sparkles className="h-8 w-8 text-accent" />
          </motion.div>
          <p className="mt-3 text-sm text-muted">Analyzing recovery options…</p>
        </div>
      ) : aiRecommendation ? (
        <>
          <div className="mb-4 rounded-lg border border-accent/20 bg-accent/5 p-4">
            <p className="text-sm leading-relaxed">{aiRecommendation.summary}</p>
            {aiRecommendation.daysLate > 0 && (
              <p className="mt-2 text-xs font-medium text-danger">
                {aiRecommendation.daysLate} day(s) past deadline
              </p>
            )}
          </div>

          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Recovery Options
          </p>
          <div className="space-y-3">
            {aiRecommendation.options.map((opt) => (
              <OptionCard
                key={opt.id}
                option={opt}
                orderId={orderId}
                onApply={applyRecovery}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">
          No recommendations available. Check your API configuration.
        </p>
      )}
    </div>
  );
}

function OptionCard({
  option,
  orderId,
  onApply,
}: {
  option: RecoveryOption;
  orderId: string;
  onApply: (orderId: string, optionId: string) => Promise<void>;
}) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      await onApply(orderId, option.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply this option.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        option.isRecommended
          ? "border-accent bg-accent/10 ai-glow"
          : "border-border bg-surface-elevated hover:border-border"
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {option.isRecommended && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
              AI Recommended
            </span>
          )}
        </div>
        <span className="text-xs text-muted">
          {Math.round(option.confidence * 100)}% conf
        </span>
      </div>
      <h4 className="font-medium">{option.title}</h4>
      <p className="mt-1 text-sm text-muted">{option.description}</p>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-success">Saves ~{option.impactDays} day(s)</span>
        <span className="text-muted">Cost index: {option.costIndex}</span>
      </div>
      <button
        onClick={handleApply}
        disabled={applying}
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50",
          option.isRecommended
            ? "bg-accent text-white hover:bg-accent-hover"
            : "border border-border text-foreground hover:bg-surface"
        )}
      >
        {applying ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : option.isRecommended ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Apply Recommended
          </>
        ) : (
          <>
            Select Alternative
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
