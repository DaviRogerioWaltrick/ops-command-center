import "server-only";
import { createHash } from "node:crypto";
import { score, TypeSafeClient, type Usage } from "@typesafe-ai/sdk";
import type { DimensionEstimate, PriorityRankingEntry } from "../types";
import { ruleBasedReason } from "./engine";
import type { WorkItemFact } from "./facts";
import {
  JEV_LEVELS,
  LEVEL_LABELS,
  rankProbabilistically,
  selectForAssessment,
  validateEstimate,
  type ItemJudgment,
} from "./probabilistic";

/**
 * The Jev (TypeSafe) side of probabilistic ranking: one request per open item,
 * two Score questions answered in parallel against a small named state. Only
 * semantic judgment goes to Jev. Dates, counts and arithmetic stay in code
 * (Jev's own docs: not a calculator, reads dates as text), so the state holds
 * no numbers to compare. Design: DESIGN_PROBABILISTIC_RANKING.md.
 *
 * Every failure (no key, over the item cap, an API error after the SDK's own
 * retries, an unusable answer) returns null so the caller falls back whole.
 * A partial Jev result is never mixed with rule-based ranking.
 *
 * The state is never logged here, and the client log level stays at its
 * default (the SDK's debug level would log request bodies).
 */

/** Bump when any question or level text changes: it invalidates the per-item cache. */
export const QUESTION_VERSION = "v1";

const LEVERAGE_QUESTION = score(
  "How much does finishing this item unblock other people or change what the organization can do? Judge from `title`, `initiative`, `scope`, `people_released` and `latest_note`. `unconfirmed_hints` are possible dependencies that nobody has verified; treat them as hints, not facts.",
  [
    "Affects only its own owner; nothing waits on it.",
    "Marginal: a small improvement or convenience for one other person.",
    "Moderate: one other person or one project is waiting on it.",
    "Significant: several people or an important initiative depend on it.",
    "Critical: a cross-team or company-level commitment cannot proceed without it.",
  ] as const,
);

const SLIP_RISK_QUESTION = score(
  "Do `latest_note` and `scope` show this item is stalled or at real risk, or is it merely old? If `waiting_on_abandoned_work` is present, consider whether the reason it was dropped puts this item at risk.",
  [
    "Healthy: active progress, nothing suggests delay.",
    "Quiet: no recent update but no sign of trouble.",
    "Uncertain: the notes hint at delay, unclear ownership or an unresolved question.",
    "At risk: the notes describe a specific obstacle or missed commitment.",
    "Stalled or failing: explicitly blocked, abandoned or contradicted by recent events.",
  ] as const,
);

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

/** What one item asks Jev: a judgment plus the tokens it cost. */
export type AskJev = (state: Record<string, unknown>) => Promise<{ judgment: ItemJudgment; usage: JevUsage }>;

/**
 * Running totals since the process started, so the cost structure can be observed before it is trusted.
 * Token counts cover requests that returned an answer. A failed request carries no token figure, so
 * the totals can sit below what the provider's dashboard shows; the dashboard is the billing record.
 */
export interface JevMeter {
  /** Requests sent to Jev, including ones that later failed. */
  requests: number;
  cacheHits: number;
  /** Requests that failed (an API error or an unusable answer), counted one by one. */
  failures: number;
  /** Ranking passes that gave up and fell back whole to the rule-based order. */
  fallbacks: number;
  inputTokens: number;
  outputTokens: number;
  /** What the most recent fallback was caused by, as described by `describeFailure`, or null. Never item state. */
  lastFailure: string | null;
}

const meter: JevMeter = { requests: 0, cacheHits: 0, failures: 0, fallbacks: 0, inputTokens: 0, outputTokens: 0, lastFailure: null };
export const getJevMeter = (): JevMeter => ({ ...meter });
export function resetJevMeter(): void {
  Object.assign(meter, { requests: 0, cacheHits: 0, failures: 0, fallbacks: 0, inputTokens: 0, outputTokens: 0, lastFailure: null });
}

/**
 * A safe, loggable description of a failure. SDK errors (typed classes with an
 * HTTP status and request id) are described by class, status and request id,
 * never by message or body, which could echo what was sent: the item state
 * must never reach a log (see the file header). Only a plain `Error` carries
 * its message, because those come from this codebase's own answer validation,
 * whose messages hold an item id and numbers only.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  if (error.constructor === Error) return `Error: ${error.message.slice(0, 200)}`;
  const { status, requestId } = error as { status?: unknown; requestId?: unknown };
  const parts = [error.constructor.name];
  if (typeof status === "number") parts.push(`HTTP ${status}`);
  if (typeof requestId === "string" && requestId) parts.push(`request ${requestId}`);
  return parts.join(", ");
}

/** Per-item cache: only items whose state changed are asked again. Process memory, like the snapshot cache. */
const judgmentCache = new Map<string, ItemJudgment>();
export const clearJevCache = (): void => judgmentCache.clear();

/** The only fields Jev sees for an item. No due dates, counts or other numbers; untrusted text is data, not instructions. */
export function buildJevState(fact: WorkItemFact): Record<string, unknown> {
  const f = fact.item;
  const state: Record<string, unknown> = { title: f.title, status: f.status };
  if (f.parent) state.initiative = f.parent.title;
  if (f.team) state.team = f.team;
  if (f.scope) state.scope = f.scope;
  if (f.lastActivityNote) state.latest_note = f.lastActivityNote;
  if (fact.releasesWorkForNames.length > 0) state.people_released = fact.releasesWorkForNames;
  if (fact.inferredBlockingNotes.length > 0) state.unconfirmed_hints = fact.inferredBlockingNotes;
  if (fact.abandonedBlockers.length > 0) {
    state.waiting_on_abandoned_work = fact.abandonedBlockers.map((b) => ({ title: b.title, why_dropped: b.note ?? "not recorded" }));
  }
  return state;
}

const cacheKey = (namespace: string, state: Record<string, unknown>): string =>
  createHash("sha256").update(`${namespace}\n${QUESTION_VERSION}\n${JSON.stringify(state)}`).digest("hex");

/** The slice of the SDK client this file uses, so tests can supply a fake. */
export interface SystemOneClient {
  systemOne(request: {
    state: Record<string, unknown>;
    questions: { leverage: typeof LEVERAGE_QUESTION; slipRisk: typeof SLIP_RISK_QUESTION };
  }): Promise<{
    answers: {
      leverage: { probabilities: object; confidence: number };
      slipRisk: { probabilities: object; confidence: number };
    };
    usage: Usage;
  }>;
}

function toEstimate(answer: { probabilities: object; confidence: number }): DimensionEstimate {
  const byLevel = answer.probabilities as Record<string, number>;
  // A missing level becomes NaN so validation rejects it instead of silently reading zero.
  return {
    probabilities: Array.from({ length: JEV_LEVELS }, (_, level) => byLevel[String(level)] ?? Number.NaN),
    confidence: answer.confidence,
  };
}

export function createAsk(client: SystemOneClient): AskJev {
  return async (state) => {
    const result = await client.systemOne({ state, questions: { leverage: LEVERAGE_QUESTION, slipRisk: SLIP_RISK_QUESTION } });
    return {
      judgment: { leverage: toEstimate(result.answers.leverage), slipRisk: toEstimate(result.answers.slipRisk) },
      usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
    };
  };
}

const hasApiKey = (): boolean => Boolean(process.env.TYPESAFE_API_KEY?.trim());

let defaultAsk: AskJev | null = null;
const getDefaultAsk = (): AskJev => (defaultAsk ??= createAsk(new TypeSafeClient() as unknown as SystemOneClient));

/**
 * The most items one pass asks the model about. More open items than this are ranked below by exact facts only.
 * Measured Oct 4, 2026 on short synthetic items: 150 items took about 11 s cold with 4 requests in flight, used
 * about 93k input tokens (about $0.004 at the listed price), and hit no rate limit; a repeat took 34 ms from the
 * cache. Real items with longer notes will be slower and dearer, so re-measure on real data.
 */
const MAX_ITEMS = Number(process.env.JEV_MAX_ITEMS ?? 150);
/** How many top positions the shortlist tries to keep provably correct (see selectForAssessment). */
export const WANTED_TOP = 20;
const CONCURRENCY = 4;

const modalLevel = (estimate: DimensionEstimate): { level: number; probability: number } => {
  let best = 0;
  estimate.probabilities.forEach((p, level) => {
    if (p > estimate.probabilities[best]) best = level;
  });
  return { level: best, probability: estimate.probabilities[best] };
};

/** Deterministic reasoning: the rule-based facts plus the model's most likely read, labelled as an estimate. No model narration in v1. */
export function describeEntry(fact: WorkItemFact, judgment: ItemJudgment, label = "model estimate"): string {
  const lev = modalLevel(judgment.leverage);
  const slip = modalLevel(judgment.slipRisk);
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  return (
    `${ruleBasedReason(fact)} — ${label}: leverage most likely "${LEVEL_LABELS.leverage[lev.level]}" (${pct(lev.probability)}), ` +
    `slip risk most likely "${LEVEL_LABELS.slipRisk[slip.level]}" (${pct(slip.probability)})`
  );
}

export interface ProbabilisticDeps {
  ask?: AskJev;
  /** The operator's tie decisions, each listing one tie group's exact members in the chosen order. */
  operatorOrder?: string[][];
  runs?: number;
  maxItems?: number;
  /** Keeps cached judgments from different sources apart (live Jev versus the demo stand-in). */
  namespace?: string;
  /** Wording for the reasoning line. The demo stand-in must never read as a model estimate. */
  estimateLabel?: string;
}

/**
 * Probabilistic ranking of the open items, or null when it cannot be produced
 * completely (the caller then falls back to the rule-based ranking).
 *
 * When there are more open items than `maxItems`, only the best `maxItems` by
 * exact facts are assessed. The rest are not dropped: they follow the assessed
 * items, ordered by exact facts, and are marked `unassessed`.
 */
export async function rankWorkItemsProbabilistic(
  facts: WorkItemFact[],
  deps: ProbabilisticDeps = {},
): Promise<PriorityRankingEntry[] | null> {
  if (facts.length === 0) return [];
  if (!deps.ask && !hasApiKey()) return null;
  const selection = selectForAssessment(facts, deps.maxItems ?? MAX_ITEMS, WANTED_TOP);
  const assess = selection.assessed;

  try {
    const ask = deps.ask ?? getDefaultAsk();
    const judgments = new Map<string, ItemJudgment>();
    let next = 0;
    // The first failure stops every worker from starting another request. Without
    // this, the other workers kept asking Jev for the remaining items after the
    // caller had already given up, spending credit on answers nobody used.
    // Requests already in flight finish and are cached (they were paid for), so every
    // answered request is metered when this returns and a retry reuses them.
    let failed = false;
    let firstFailure: unknown = null;
    const worker = async () => {
      while (!failed && next < assess.length) {
        const fact = assess[next++];
        try {
          const state = buildJevState(fact);
          const key = cacheKey(deps.namespace ?? "live", state);
          const cached = judgmentCache.get(key);
          if (cached) {
            meter.cacheHits++;
            judgments.set(fact.item.id, cached);
            continue;
          }
          meter.requests++;
          const { judgment: raw, usage } = await ask(state);
          meter.inputTokens += usage.input_tokens;
          meter.outputTokens += usage.output_tokens;
          // Validated before it is cached, so an unusable answer is never reused.
          const judgment: ItemJudgment = {
            leverage: validateEstimate(raw.leverage, `${fact.item.id} leverage`),
            slipRisk: validateEstimate(raw.slipRisk, `${fact.item.id} slip risk`),
          };
          judgmentCache.set(key, judgment);
          judgments.set(fact.item.id, judgment);
        } catch (error) {
          meter.failures++;
          if (!failed) {
            failed = true;
            firstFailure = error;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, assess.length) }, worker));
    if (failed) throw firstFailure;

    const assessed = rankProbabilistically(assess, judgments, {
      describe: (fact, judgment) => describeEntry(fact, judgment, deps.estimateLabel),
      operatorOrder: deps.operatorOrder,
      runs: deps.runs,
    });
    const note = { assessed: assess.length, total: facts.length, guaranteedTop: selection.guaranteedTop };
    const rest: PriorityRankingEntry[] = selection.unassessed.map((fact, index) => ({
      workItemId: fact.item.id,
      rank: assessed.length + index + 1,
      reasoning: `${ruleBasedReason(fact)} — not assessed by the model: there are more open items than one pass asks about, so this one has no rank probabilities and is ordered by exact facts only`,
      releasesWorkFor: fact.releasesWorkForNames,
      source: "probabilistic",
      unassessed: note,
    }));
    return [...assessed, ...rest];
  } catch (error) {
    meter.fallbacks++;
    meter.lastFailure = describeFailure(error);
    console.error(`[jev] ranking fell back: ${meter.lastFailure}`);
    return null;
  }
}
