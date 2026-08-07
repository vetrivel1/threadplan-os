import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Presentational building blocks for the planning rules page.
 *
 * The audience is a production planner, not a developer, so these deliberately
 * present a rule as: what it means in words, the sum worked through on real
 * orders, and what it changed in today's plan.
 */

/**
 * A collapsible, reorderable rule.
 *
 * Built on native details/summary so opening a rule stays keyboard accessible
 * and needs no state. The reorder buttons live inside the summary, so their
 * clicks have to be stopped from also toggling the panel.
 */
export function EngineSection({
  icon: Icon,
  title,
  question,
  accent = "text-accent",
  order,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  /** The planner's question this rule answers, shown while collapsed. */
  question: string;
  accent?: string;
  /** Flex order, so the list can be resequenced without moving the markup. */
  order?: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  children: React.ReactNode;
}) {
  const reorder = (action?: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    action?.();
  };

  return (
    <details
      className="group rounded-xl border border-border bg-surface transition-colors hover:border-border/80"
      style={order == null ? undefined : { order }}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", accent)} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
            {question}
          </p>
        </div>

        {(onMoveUp || onMoveDown) && (
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={reorder(onMoveUp)}
              disabled={!canMoveUp}
              aria-label={`Move ${title} earlier`}
              className="px-2 py-1.5 text-muted transition-colors hover:bg-surface-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={reorder(onMoveDown)}
              disabled={!canMoveDown}
              aria-label={`Move ${title} later`}
              className="border-l border-border px-2 py-1.5 text-muted transition-colors hover:bg-surface-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <ChevronDown className="mt-1.5 h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border-subtle px-5 py-5">
        {children}
      </div>
    </details>
  );
}

/** A named step inside a section, e.g. "The rule" then "Today's numbers". */
export function Step({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

/** A division rendered as a stacked fraction so it reads like written maths. */
export function Fraction({
  top,
  bottom,
  result,
}: {
  top: string;
  bottom: string;
  result?: string;
}) {
  return (
    <span className="inline-flex items-center gap-3 align-middle">
      <span className="inline-flex flex-col text-center">
        <span className="px-2 pb-1 text-sm">{top}</span>
        <span className="border-t border-muted px-2 pt-1 text-sm">
          {bottom}
        </span>
      </span>
      {result && (
        <>
          <span className="text-sm text-muted">=</span>
          <span className="text-sm font-semibold text-accent-hover">
            {result}
          </span>
        </>
      )}
    </span>
  );
}

/** The rule stated in words, on a tinted panel so it reads as the definition. */
export function RuleBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-accent/25 bg-accent/5 px-5 py-4 text-sm leading-relaxed">
      {children}
    </div>
  );
}

/** The same rule with real numbers substituted in. */
export function WorkedExample({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-elevated px-5 py-4">
      {title && (
        <p className="mb-2 text-xs font-medium text-foreground">{title}</p>
      )}
      <div className="space-y-1.5 text-sm text-muted">{children}</div>
    </div>
  );
}

/** What the rule actually did to the plan the planner is about to run. */
export function EffectNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border-l-2 border-l-success bg-success/5 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-success">
        What this changed in today&apos;s plan
      </p>
      <p className="mt-1 text-sm leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

export interface Column {
  label: string;
  align?: "left" | "right";
  /** Shown as a hint under the column heading. */
  hint?: string;
}

export function Table({
  columns,
  children,
  minWidth,
}: {
  columns: Column[];
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table
        className="w-full text-left text-sm"
        style={minWidth ? { minWidth } : undefined}
      >
        <thead className="bg-surface-elevated text-xs text-muted">
          <tr>
            {columns.map((col) => (
              <th
                key={col.label}
                className={cn(
                  "px-4 py-2.5 font-medium",
                  col.align === "right" && "text-right"
                )}
              >
                {col.label}
                {col.hint && (
                  <span className="mt-0.5 block text-[10px] font-normal opacity-70">
                    {col.hint}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <tr className="border-t border-border-subtle">{children}</tr>;
}

export function Cell({
  children,
  align = "left",
  tone = "default",
  strong,
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  tone?: "default" | "muted" | "good" | "warn" | "bad" | "accent";
  strong?: boolean;
  className?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    muted: "text-muted",
    good: "text-success",
    warn: "text-warning",
    bad: "text-danger",
    accent: "text-accent-hover",
  }[tone];

  return (
    <td
      className={cn(
        "px-4 py-2.5",
        align === "right" && "text-right",
        toneClass,
        strong && "font-semibold",
        className
      )}
    >
      {children}
    </td>
  );
}

export function Pill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
}) {
  const toneClass = {
    neutral: "bg-surface-elevated text-muted",
    good: "bg-success/15 text-success",
    warn: "bg-warning/15 text-warning",
    bad: "bg-danger/15 text-danger",
    accent: "bg-accent/15 text-accent-hover",
  }[tone];

  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        toneClass
      )}
    >
      {label}
    </span>
  );
}

/** A labelled range input for one planner-tuned weight. */
export function Slider({
  label,
  hint,
  detail,
  value,
  defaultValue,
  min,
  max,
  step,
  format: formatValue,
  onChange,
}: {
  label: string;
  hint?: string;
  /** Plain-language "raise this if / lower this if" guidance for a planner. */
  detail?: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const display = formatValue ? formatValue(value) : String(value);
  const isDefault = value === defaultValue;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium">{label}</label>
        <span className="font-mono text-sm text-accent-hover">{display}</span>
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--color-accent)]"
      />
      {!isDefault && (
        <p className="mt-0.5 text-[11px] text-muted">
          default {formatValue ? formatValue(defaultValue) : defaultValue}
        </p>
      )}
      {detail && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted/80">
          {detail}
        </p>
      )}
    </div>
  );
}

/** A labelled on/off switch for one engine fidelity flag. */
export function Toggle({
  label,
  hint,
  detail,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  /** Plain-language consequence of flipping this switch. */
  detail?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
        {detail && (
          <span className="mt-1 block text-[11px] leading-relaxed text-muted/80">
            {detail}
          </span>
        )}
      </span>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-accent" : "bg-surface-elevated border border-border"
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4.5" : "translate-x-1"
          )}
          style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
        />
      </span>
    </label>
  );
}

export function Bar({
  fraction,
  tone = "accent",
}: {
  fraction: number;
  tone?: "accent" | "warning" | "danger" | "success";
}) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  const toneClass = {
    accent: "bg-accent",
    warning: "bg-warning",
    danger: "bg-danger",
    success: "bg-success",
  }[tone];

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
      <div
        className={cn("h-full rounded-full", toneClass)}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
