import {
  COMPLEXITY_TIERS,
  efficiencyAtDay,
  type ComplexityTier,
} from "@/lib/engine/complexity";
import { VIABILITY_EFFICIENCY_THRESHOLD } from "@/lib/engine/run-size";

/**
 * The four ramp curves overlaid. Complexity controls how long a line takes to
 * reach full speed on a style, not how fast it runs once it is there, and
 * showing the curves together is the quickest way to make that land.
 */

const DAYS = 10;
const Y_MIN = 0.4;

const WIDTH = 560;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 38 };

const TIER_COLOR: Record<ComplexityTier, string> = {
  T1: "var(--color-packing)",
  T2: "var(--color-cutting)",
  T3: "var(--color-sewing)",
  T4: "var(--color-knitting)",
};

const plotWidth = WIDTH - PAD.left - PAD.right;
const plotHeight = HEIGHT - PAD.top - PAD.bottom;

function x(day: number): number {
  return PAD.left + ((day - 1) / (DAYS - 1)) * plotWidth;
}

function y(efficiency: number): number {
  const clamped = Math.max(Y_MIN, Math.min(1, efficiency));
  return PAD.top + (1 - (clamped - Y_MIN) / (1 - Y_MIN)) * plotHeight;
}

export function LearningCurveChart() {
  const gridLines = [0.4, 0.6, 0.8, 1.0];
  const tiers = Object.keys(COMPLEXITY_TIERS) as ComplexityTier[];

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Learning curve efficiency by complexity tier over the first ten production days"
      >
        {gridLines.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--color-border-subtle)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(value) + 3}
              textAnchor="end"
              fill="var(--color-muted)"
              fontSize={9}
            >
              {Math.round(value * 100)}%
            </text>
          </g>
        ))}

        {/* Efficiency at which run-size viability considers a line up to speed. */}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(VIABILITY_EFFICIENCY_THRESHOLD)}
          y2={y(VIABILITY_EFFICIENCY_THRESHOLD)}
          stroke="var(--color-warning)"
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.7}
        />
        <text
          x={WIDTH - PAD.right}
          y={y(VIABILITY_EFFICIENCY_THRESHOLD) - 5}
          textAnchor="end"
          fill="var(--color-warning)"
          fontSize={9}
        >
          counts as up to speed ({Math.round(VIABILITY_EFFICIENCY_THRESHOLD * 100)}%)
        </text>

        {[1, 3, 5, 7, 10].map((day) => (
          <text
            key={day}
            x={x(day)}
            y={HEIGHT - 8}
            textAnchor="middle"
            fill="var(--color-muted)"
            fontSize={9}
          >
            Day {day}
          </text>
        ))}

        {tiers.map((tier) => {
          const curve = COMPLEXITY_TIERS[tier].curve;
          const path = Array.from({ length: DAYS }, (_, i) => {
            const day = i + 1;
            return `${i === 0 ? "M" : "L"}${x(day).toFixed(1)},${y(
              efficiencyAtDay(curve, day)
            ).toFixed(1)}`;
          }).join(" ");

          return (
            <g key={tier}>
              <path
                d={path}
                fill="none"
                stroke={TIER_COLOR[tier]}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <circle
                cx={x(1)}
                cy={y(curve.start)}
                r={3}
                fill={TIER_COLOR[tier]}
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
        {tiers.map((tier) => (
          <span key={tier} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ background: TIER_COLOR[tier] }}
            />
            <span className="text-muted">
              {COMPLEXITY_TIERS[tier].label} — starts at{" "}
              {Math.round(COMPLEXITY_TIERS[tier].curve.start * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
