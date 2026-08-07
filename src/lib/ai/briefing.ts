import OpenAI from "openai";

/**
 * One order whose projected completion moved past its delivery deadline as a
 * result of today's batch of line-level output entries.
 */
export interface BatchOrderImpact {
  orderNumber: string;
  styleCode: string;
  projectedCompletion: string;
  deliveryDeadline: string;
  daysLate: number;
}

/**
 * The measured facts of one end-of-day replan — every field here is computed
 * by the scheduler from the planner's entries, not by the model. The model's
 * only job is to turn this into a briefing a planner can read in 20 seconds.
 */
export interface BatchBriefingContext {
  editsCount: number;
  linesReported: number;
  /** Sum of (actual − planned) across every entry. Negative means net short. */
  totalVarianceUnits: number;
  warnings: string[];
  atRisk: BatchOrderImpact[];
  onTrackCount: number;
}

export interface BatchBriefing {
  summary: string;
  highlights: string[];
}

function buildFallback(ctx: BatchBriefingContext): BatchBriefing {
  const varianceLabel =
    ctx.totalVarianceUnits < 0
      ? `${Math.abs(ctx.totalVarianceUnits)} pcs short of plan`
      : ctx.totalVarianceUnits > 0
        ? `${ctx.totalVarianceUnits} pcs ahead of plan`
        : "exactly to plan";

  const summary = `${ctx.linesReported} line${ctx.linesReported === 1 ? "" : "s"} reported output today across ${ctx.editsCount} entr${ctx.editsCount === 1 ? "y" : "ies"}, net ${varianceLabel}. ${
    ctx.atRisk.length > 0
      ? `${ctx.atRisk.length} order${ctx.atRisk.length === 1 ? "" : "s"} ${ctx.atRisk.length === 1 ? "is" : "are"} now projected past delivery.`
      : "No orders moved past their delivery deadline."
  }`;

  const highlights = ctx.atRisk.map(
    (o) =>
      `${o.orderNumber} (${o.styleCode}) — now ${o.daysLate} day(s) past deadline, projected ${o.projectedCompletion} against ${o.deliveryDeadline}.`
  );

  return { summary, highlights };
}

/**
 * Narrates one end-of-day batch of line output entries — the AI-repositioned
 * counterpart to the per-order recovery narration in `copilot.ts`. Where that
 * rewords a single simulated recovery card, this summarizes a multi-order
 * diff: the harder, genuinely model-suited half of "AI Replan", since a
 * bulk entry screen can move several orders at once and a planner needs the
 * headline, not N separate popups.
 */
export async function generateBatchBriefing(
  ctx: BatchBriefingContext
): Promise<BatchBriefing> {
  const fallback = buildFallback(ctx);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || ctx.editsCount === 0) return fallback;

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are the threadsPlan end-of-day planning briefing.
You are given the FACTS of today's batch replan — every number (variance, days late, projected dates) was computed by the production scheduler, not by you.
Sign convention for totalVarianceUnits: negative means output fell short of plan (bad — less was produced than planned); positive means output exceeded plan (good — more was produced than planned). Never describe a negative value as "positive" or as an improvement, and never describe a positive value as a shortfall.
Write a short briefing a floor planner can read in about 20 seconds. Return JSON with:
- summary: 2-3 plain-language sentences covering what happened today and the headline consequence
- highlights: array of short strings, one per at-risk order, in plain language a planner would say out loud
Never invent a number, order, or date not present in the input. If atRisk is empty, say so plainly — do not manufacture concern to sound useful.`,
        },
        {
          role: "user",
          content: JSON.stringify(ctx),
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content) as {
      summary?: string;
      highlights?: string[];
    };

    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : fallback.summary,
      highlights:
        Array.isArray(parsed.highlights) && parsed.highlights.length > 0
          ? parsed.highlights.filter((h): h is string => typeof h === "string")
          : fallback.highlights,
    };
  } catch {
    return fallback;
  }
}
