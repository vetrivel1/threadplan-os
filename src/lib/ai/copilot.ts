import OpenAI from "openai";
import type { Order, RecoveryOption, Style } from "../types";
import { STAGE_LABELS } from "../types";

export interface CopilotContext {
  order: Order;
  style: Style;
  daysLate: number;
  projectedCompletion: string;
  affectedOrders: string[];
  warnings: string[];
  /**
   * Options already simulated through the scheduler. When present these are
   * authoritative: the model may reword them but must not invent the numbers.
   */
  simulatedOptions?: RecoveryOption[];
}

function buildRuleBasedOptions(ctx: CopilotContext): RecoveryOption[] {
  const options: RecoveryOption[] = [
    {
      id: "ot-sewing",
      type: "overtime",
      title: "Add 2h overtime on Sewing line",
      description:
        "Extend sewing shift by 2 hours for 3 consecutive days to recover ~18% daily output.",
      impactDays: Math.max(1, Math.ceil(ctx.daysLate * 0.6)),
      costIndex: 65,
      confidence: 0.82,
      isRecommended: ctx.daysLate <= 4,
      details: { stage: "sewing", hours: 2, days: 3 },
    },
    {
      id: "swap-seq",
      type: "sequence_swap",
      title: "Swap with lower-priority Order",
      description:
        "Re-sequence a lower-priority order after this one on the sewing line to free immediate capacity.",
      impactDays: Math.max(1, Math.ceil(ctx.daysLate * 0.75)),
      costIndex: 35,
      confidence: 0.71,
      isRecommended: ctx.daysLate > 4 && ctx.daysLate <= 7,
      details: { swapType: "priority_inversion" },
    },
    {
      id: "split-line",
      type: "line_split",
      title: "Split across dual sewing lines",
      description:
        "Run remaining sewing volume on a secondary line at 70% efficiency to parallelize completion.",
      impactDays: Math.max(1, Math.ceil(ctx.daysLate * 0.5)),
      costIndex: 80,
      confidence: 0.68,
      isRecommended: ctx.daysLate > 7,
      details: { stage: "sewing", splitRatio: 0.5 },
    },
    {
      id: "expedite-pack",
      type: "expedite_stage",
      title: "Expedite packing with solid-carton flow",
      description:
        "Temporarily switch to solid-carton packing to eliminate assorted-box cycle drag.",
      impactDays: Math.max(1, Math.ceil(ctx.daysLate * 0.4)),
      costIndex: 45,
      confidence: 0.77,
      isRecommended: ctx.order.packingType === "assorted",
      details: { stage: "packing", packingOverride: "solid" },
    },
  ];

  const recommended = options.filter((o) => o.isRecommended);
  if (recommended.length === 0) {
    const best = [...options].sort((a, b) => a.impactDays - b.impactDays)[0];
    if (best) best.isRecommended = true;
  } else if (recommended.length > 1) {
    const best = recommended.sort(
      (a, b) => a.costIndex / a.confidence - b.costIndex / b.confidence
    )[0];
    for (const o of options) o.isRecommended = o.id === best?.id;
  }

  return options;
}

/**
 * Keeps the simulated numbers authoritative while letting the model improve the
 * wording. Anything the model invented that we did not simulate is discarded.
 */
function reconcileWithGrounded(
  grounded: RecoveryOption[],
  fromModel: RecoveryOption[] | undefined
): RecoveryOption[] {
  if (!fromModel?.length) return grounded;

  const byId = new Map(fromModel.map((o) => [o.id, o]));
  return grounded.map((option) => {
    const narrated = byId.get(option.id);
    if (!narrated) return option;
    return {
      ...option,
      title:
        typeof narrated.title === "string" && narrated.title.trim()
          ? narrated.title
          : option.title,
      description:
        typeof narrated.description === "string" && narrated.description.trim()
          ? narrated.description
          : option.description,
    };
  });
}

export async function generateAIRecommendations(
  ctx: CopilotContext
): Promise<{ summary: string; options: RecoveryOption[] }> {
  // Simulated options beat both the rule-based table and anything the model
  // would guess, because their impact was measured by the scheduler.
  const grounded = ctx.simulatedOptions?.length ? ctx.simulatedOptions : null;
  const fallback = grounded ?? buildRuleBasedOptions(ctx);
  const fallbackSummary = `Order ${ctx.order.orderNumber} (${ctx.style.code}) is projected ${ctx.daysLate} day(s) past deadline. ${ctx.warnings.join(" ")}`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { summary: fallbackSummary, options: fallback };
  }

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: grounded
            ? `You are the threadsPlan AI Co-Pilot for apparel production scheduling.
The recovery options supplied in "simulatedOptions" were produced by running each
one through the production scheduler, so their impactDays, costIndex, confidence
and isRecommended values are measured facts.
Return JSON with:
- summary: 2-3 sentences explaining the delay and why the recommended option is the right call, in plain language for a planner
- options: the same options, unchanged except that you may reword title and description to be clearer
Never alter impactDays, costIndex, confidence, isRecommended, id or type. Never add or remove options.
Focus on knitting→cutting→sewing→packing pipeline, SMV, learning curves, packing ratios.`
            : `You are the threadsPlan AI Co-Pilot for apparel production scheduling.
Analyze delay scenarios and return JSON with:
- summary: 2-3 sentence planner-friendly explanation
- options: array of recovery options with id, type (overtime|sequence_swap|line_split|expedite_stage), title, description, impactDays, costIndex (0-100), confidence (0-1), isRecommended (boolean, exactly one true), details (object)
Focus on knitting→cutting→sewing→packing pipeline, SMV, learning curves, packing ratios.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            order: ctx.order.orderNumber,
            style: ctx.style.code,
            quantity: ctx.order.quantity,
            packingType: ctx.order.packingType,
            deliveryDeadline: ctx.order.deliveryDeadline,
            projectedCompletion: ctx.projectedCompletion,
            daysLate: ctx.daysLate,
            smv: ctx.style.smv,
            complexity: ctx.style.complexity,
            affectedOrders: ctx.affectedOrders,
            warnings: ctx.warnings,
            stages: STAGE_LABELS,
            simulatedOptions: grounded ?? undefined,
          }),
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { summary: fallbackSummary, options: fallback };

    const parsed = JSON.parse(content) as {
      summary?: string;
      options?: RecoveryOption[];
    };

    const options = grounded
      ? reconcileWithGrounded(grounded, parsed.options)
      : parsed.options?.length
        ? parsed.options
        : fallback;

    const hasRecommended = options.some((o) => o.isRecommended);
    if (!hasRecommended && options[0]) options[0].isRecommended = true;

    return {
      summary: parsed.summary ?? fallbackSummary,
      options,
    };
  } catch {
    return { summary: fallbackSummary, options: fallback };
  }
}
