import "server-only";
import { generateText, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { PriorityRankingEntry } from "../types";
import type { WorkItemFact } from "./facts";

const SEVERITY_WEIGHT: Record<string, number> = { red: 100, amber: 50, green: 10 };
const RELEASES_WORK_WEIGHT = 30;
const INFERRED_BLOCK_WEIGHT = 10;
// An item waiting on work that was abandoned needs a keep / re-scope / drop
// decision (scope), more urgently the closer its own due date is (time).
// Weights and the 7-day horizon were chosen by the operator on 2026-09-30.
const REPLAN_WEIGHT = 40;
const REPLAN_DUE_SOON_WEIGHT = 20;
const DUE_SOON_DAYS = 7;

export const needsReplanning = (fact: WorkItemFact): boolean => fact.abandonedBlockers.length > 0;
const dueSoon = (fact: WorkItemFact): boolean => fact.daysUntilDue != null && fact.daysUntilDue <= DUE_SOON_DAYS;

function ruleBasedScore(fact: WorkItemFact): number {
  return (
    SEVERITY_WEIGHT[fact.severity.level] +
    fact.releasesWorkForNames.length * RELEASES_WORK_WEIGHT +
    fact.inferredBlockingNotes.length * INFERRED_BLOCK_WEIGHT +
    (needsReplanning(fact) ? REPLAN_WEIGHT + (dueSoon(fact) ? REPLAN_DUE_SOON_WEIGHT : 0) : 0)
  );
}

/** Soonest due date first; no due date last. Only breaks ties between equal scores; adds no weight. */
const dueDateOrder = (a: WorkItemFact, b: WorkItemFact): number =>
  (a.daysUntilDue ?? Number.POSITIVE_INFINITY) - (b.daysUntilDue ?? Number.POSITIVE_INFINITY);

export function ruleBasedReason(fact: WorkItemFact): string {
  const parts: string[] = [fact.severity.reason];
  if (fact.releasesWorkForNames.length > 0) {
    parts.push(`releases work for ${fact.releasesWorkForNames.join(", ")}`);
  }
  if (fact.inferredBlockingNotes.length > 0) {
    parts.push(`may also be blocking: ${fact.inferredBlockingNotes.join("; ")}`);
  }
  if (needsReplanning(fact)) {
    parts.push(`needs re-planning: waiting on abandoned work (${fact.abandonedBlockers.map((b) => b.title).join("; ")})`);
  }
  if (fact.daysUntilDue != null && fact.daysUntilDue >= 0 && dueSoon(fact)) {
    parts.push(fact.daysUntilDue === 0 ? "due today" : `due in ${fact.daysUntilDue} day${fact.daysUntilDue === 1 ? "" : "s"}`);
  }
  return parts.join(" — ");
}

/** Deterministic fallback ranking — never leaves the page empty, just without model-authored narrative. Exported for tests. */
export function rankWithRules(facts: WorkItemFact[]): PriorityRankingEntry[] {
  return [...facts]
    .map((fact) => ({ fact, score: ruleBasedScore(fact) }))
    .sort((a, b) => b.score - a.score || dueDateOrder(a.fact, b.fact))
    .map(({ fact, score }, index) => ({
      workItemId: fact.item.id,
      rank: index + 1,
      score,
      reasoning: ruleBasedReason(fact),
      releasesWorkFor: fact.releasesWorkForNames,
      source: "rule-based" as const,
    }));
}

const MAX_ATTEMPTS = 2;

interface RawRankedEntry {
  workItemId: string;
  reasoning: string;
}

/** Calls the model once and returns its raw entries. Injectable so the retry and fallback logic is testable without a model. */
export type RankingGenerator = (facts: WorkItemFact[]) => Promise<RawRankedEntry[]>;

export function buildPrompt(facts: WorkItemFact[]): string {
  const rows = facts
    .map((fact) => {
      const f = fact.item;
      const bits = [
        `id="${f.id}"`,
        `title="${f.title}"`,
        f.parent ? `initiative="${f.parent.title}"` : null,
        f.team ? `team="${f.team}"` : null,
        `rule_severity=${fact.severity.level} (${fact.severity.reason})`,
        fact.releasesWorkForNames.length > 0 ? `releases_work_for=[${fact.releasesWorkForNames.join(", ")}]` : null,
        fact.inferredBlockingNotes.length > 0 ? `possibly_also_blocking="${fact.inferredBlockingNotes.join("; ")}"` : null,
        fact.daysUntilDue != null ? `due_in_days=${fact.daysUntilDue}${fact.daysUntilDue < 0 ? " (overdue)" : ""}` : "no_due_date",
        fact.abandonedBlockers.length > 0
          ? `waiting_on_abandoned_work=[${fact.abandonedBlockers.map((b) => `"${b.title}"${b.note ? ` (why: ${b.note})` : ""}`).join("; ")}]${fact.abandonedTrackedMs != null ? ` effort_already_sunk_hours=${Math.round((fact.abandonedTrackedMs / 3_600_000) * 10) / 10}` : " effort_already_sunk=unknown"}`
          : null,
        fact.ownerOpenCount != null ? `owner_open_items=${fact.ownerOpenCount}` : null,
        fact.ownerOverdueCount != null ? `owner_overdue_items=${fact.ownerOverdueCount}` : null,
        f.scope ? `scope="${f.scope}"` : null,
        f.lastActivityNote ? `latest_note="${f.lastActivityNote}"` : null,
      ].filter(Boolean);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");

  return `You are an executive assistant helping an operations lead decide what to personally focus on next, across every connected work-tracking and CRM system. You are not just flagging overdue work — you are reasoning about leverage: which item, if handled now, does the most to unblock other people and reduce real risk.

Weigh, in rough order of importance:
1. Whether finishing this item releases work for other people (releases_work_for) — an item blocking three teammates outranks a similarly overdue item blocking no one.
2. Time: how overdue or at-risk it genuinely is. rule_severity only reflects days overdue, so also use due_in_days: an item due within about 7 days is under real time pressure even though it is not late yet. Read the scope and latest note to judge whether it's really at risk or just old.
3. Whether the owner is already overloaded (owner_open_items / owner_overdue_items) — flag this in your reasoning when it's relevant, but do not automatically deprioritize an overloaded owner's most important item; note the overload as a staffing risk instead.
4. waiting_on_abandoned_work means this item depended on work that was dropped, not delivered, so its premise has changed and it needs a keep / re-scope / drop decision. This must raise its priority. Weigh it by scope (does the item still matter, given why the other work was dropped?), time (due_in_days: the closer the due date, the more urgent the decision) and resources (the owner's load; effort_already_sunk_hours only when it is given. When effort_already_sunk=unknown, do not say anything about sunk effort or cost, not even that it is low or high, because no data exists). Name the decision needed in your reasoning and present it as an option for the operator, not a verdict.
5. possibly_also_blocking notes are AI-inferred, not confirmed — treat them as a hint worth mentioning, not a certainty on par with releases_work_for.

Items:
${rows}

Return every item id listed above exactly once, ordered from highest to lowest priority (array order is the rank), each with a one-sentence, plain-English reasoning a busy operator can act on immediately — name the actual leverage (who it unblocks, what it's genuinely at risk of), not a restatement of the raw fields.

There are exactly ${facts.length} items. Return exactly ${facts.length} entries, one per id, copying each id exactly as written above including its prefix.`;
}

/**
 * Turns the model's raw entries into a ranking, or null unless it is complete:
 * every open item exactly once, nothing unknown. A partial list is rejected
 * rather than shipped, because an item the model dropped could be an
 * important one. Exported for tests.
 */
export function assembleRanking(facts: WorkItemFact[], entries: RawRankedEntry[]): PriorityRankingEntry[] | null {
  const factById = new Map(facts.map((f) => [f.item.id, f]));
  const seen = new Set<string>();
  const ranked: PriorityRankingEntry[] = [];

  for (const entry of entries) {
    const fact = factById.get(entry.workItemId);
    if (!fact || seen.has(entry.workItemId)) continue;
    seen.add(entry.workItemId);
    ranked.push({
      workItemId: entry.workItemId,
      rank: ranked.length + 1,
      score: ruleBasedScore(fact),
      reasoning: entry.reasoning,
      releasesWorkFor: fact.releasesWorkForNames,
      source: "ai",
    });
  }

  return ranked.length === facts.length ? ranked : null;
}

const generateWithModel: RankingGenerator = async (facts) => {
  // The schema only admits the exact ids. Measured on the fixtures before this
  // was added, the model sometimes dropped the "source:" prefix from ids
  // (about 1 run in 10), which made valid ids look unknown.
  const ids = facts.map((f) => f.item.id) as [string, ...string[]];
  const schema = z.object({
    ranking: z.array(z.object({ workItemId: z.enum(ids), reasoning: z.string().max(280) })),
  });
  const model = anthropic(process.env.AI_INSIGHTS_MODEL || "claude-sonnet-5");
  const result = await generateText({
    model,
    output: Output.object({ schema }),
    prompt: buildPrompt(facts),
    providerOptions: { anthropic: { effort: "low" } },
  });
  return result.output.ranking;
};

/**
 * Ranks open work items with AI-authored reasoning, falling back to the
 * deterministic rule-based ranking when no attempt yields a complete list
 * (no API key, model error, dropped or repeated items): the same
 * graceful-degradation contract used by every AI layer in this project.
 *
 * Measured before the retry existed: about 30% of live calls failed the
 * completeness check, almost always because the model returned one item too
 * few, and none raised an error. One retry recovered those runs in testing,
 * at about 10 to 15 seconds extra on the runs that need it.
 */
export async function rankWorkItems(
  facts: WorkItemFact[],
  generate: RankingGenerator = generateWithModel,
): Promise<PriorityRankingEntry[]> {
  if (facts.length === 0) return [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ranked = assembleRanking(facts, await generate(facts));
      if (ranked) return ranked;
    } catch {
      // Treated like an incomplete answer: retry, then fall back.
    }
  }
  return rankWithRules(facts);
}
