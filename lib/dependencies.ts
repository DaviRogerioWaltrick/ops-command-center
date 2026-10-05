import "server-only";
import { createHash } from "node:crypto";
import { generateText, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { describeFailure } from "./ranking/jev";
import type { DependencyEdge, Person, WorkItem } from "./types";

export interface DependencyImpact {
  /** Open items blocked by this one, via confirmed edges only. */
  blockedItemIds: string[];
  /** Distinct people whose work is released once this item ships. */
  releasesWorkFor: Person[];
}

/**
 * Deterministic graph read over *confirmed* edges only — this is what a
 * connector's own API actually states, never a guess. Answers "if this item
 * closes, whose work opens up?" for every open work item.
 *
 * Works identically whether `blockerId` and `blockedId` come from the same
 * connector or two different ones — ids are already source-namespaced
 * (`clickup:...`, `salesforce:...`), so nothing here special-cases the
 * single-source case. That's deliberate, not incidental: no confirmed edge
 * can ever actually cross sources (a connector's API only knows its own
 * records), so the only way a cross-source dependency is ever found at all
 * is `inferDependencyEdges` below, reading across the full merged set. See
 * COMPETITIVE_ANALYSIS.md — the capability a single source system's own
 * dependency feature cannot cover (an argument, not a verified claim).
 */
export function buildDependencyImpact(
  workItems: WorkItem[],
  edges: DependencyEdge[],
): Map<string, DependencyImpact> {
  const itemsById = new Map(workItems.map((item) => [item.id, item]));
  const confirmed = edges.filter((e) => e.confidence === "confirmed");

  const impact = new Map<string, DependencyImpact>();
  for (const item of workItems) {
    impact.set(item.id, { blockedItemIds: [], releasesWorkFor: [] });
  }

  for (const edge of confirmed) {
    const blocker = impact.get(edge.blockerId);
    const blockerItem = itemsById.get(edge.blockerId);
    const blockedItem = itemsById.get(edge.blockedId);
    if (!blocker || !blockerItem || blockerItem.isDone || !blockedItem) continue;

    blocker.blockedItemIds.push(edge.blockedId);
    if (blockedItem.assignee && !blocker.releasesWorkFor.some((p) => p.id === blockedItem.assignee!.id)) {
      blocker.releasesWorkFor.push(blockedItem.assignee);
    }
  }

  return impact;
}

export interface OrphanedItem {
  item: WorkItem;
  /** Finished blockers that were abandoned, not delivered. */
  abandonedBlockers: WorkItem[];
}

/**
 * Open items waiting on a confirmed blocker that was abandoned. buildDependencyImpact
 * treats any finished blocker as no longer blocking, which is right for delivered
 * work but hides a different situation: the thing this item was waiting on will
 * never arrive, so the item needs re-planning, not just a green light. Confirmed
 * edges only, like buildDependencyImpact. Data layer only; how it is surfaced in
 * the UI is a separate design question (see BACKLOG.md).
 */
export function findItemsBlockedByAbandonedWork(workItems: WorkItem[], edges: DependencyEdge[]): OrphanedItem[] {
  const itemsById = new Map(workItems.map((item) => [item.id, item]));
  const byBlockedId = new Map<string, WorkItem[]>();

  for (const edge of edges) {
    if (edge.confidence !== "confirmed") continue;
    const blocker = itemsById.get(edge.blockerId);
    const blocked = itemsById.get(edge.blockedId);
    if (!blocker || !blocked || blocked.isDone) continue;
    if (!blocker.isDone || blocker.outcome !== "abandoned") continue;
    byBlockedId.set(blocked.id, [...(byBlockedId.get(blocked.id) ?? []), blocker]);
  }

  return Array.from(byBlockedId, ([id, abandonedBlockers]) => ({ item: itemsById.get(id)!, abandonedBlockers }));
}

/**
 * Running totals for the dependency-inference call (an Anthropic request, billed separately from Jev),
 * so its cost can be observed before it is trusted. Token counts cover calls that returned an answer;
 * the provider's dashboard is the billing record.
 */
export interface InferenceMeter {
  /** Requests sent, full and incremental. */
  calls: number;
  /** Of `calls`, the ones that examined only new or changed items. */
  incrementalCalls: number;
  /** Rebuilds that found nothing new or changed and reused the remembered links without a request. */
  reusedRebuilds: number;
  /** Calls that failed (an API error or an unusable answer); each one fell back to the remembered links. */
  failures: number;
  inputTokens: number;
  outputTokens: number;
  /** Items sent with their full text in the most recent call. */
  lastItemCount: number;
  /** The most recent failure as described by `describeFailure` (never item text), or null. */
  lastFailure: string | null;
}

const inferenceMeter: InferenceMeter = { calls: 0, incrementalCalls: 0, reusedRebuilds: 0, failures: 0, inputTokens: 0, outputTokens: 0, lastItemCount: 0, lastFailure: null };
export const getInferenceMeter = (): InferenceMeter => ({ ...inferenceMeter });
export function resetInferenceMeter(): void {
  Object.assign(inferenceMeter, { calls: 0, incrementalCalls: 0, reusedRebuilds: 0, failures: 0, inputTokens: 0, outputTokens: 0, lastItemCount: 0, lastFailure: null });
}

const inferredEdgeSchema = z.object({
  blockerId: z.string(),
  blockedId: z.string(),
  /** Which of the two items has the scope or latest note that justifies the link. */
  evidenceId: z.string(),
  note: z.string().max(200),
});

const inferenceSchema = z.object({
  edges: z.array(inferredEdgeSchema),
});

/** An inferred link plus the item whose text justified it, so the link can be kept or dropped when only that item changes. */
type RememberedEdge = DependencyEdge & { evidenceId: string };

/**
 * What the last successful inference run saw and found. Process memory, the same stand-in
 * pattern as the snapshot cache: it resets on restart, so the next run is a full one.
 */
const memory: { fingerprints: Map<string, string>; edges: RememberedEdge[]; fullAt: number } = {
  fingerprints: new Map(),
  edges: [],
  fullAt: 0,
};
export function clearInferenceMemory(): void {
  memory.fingerprints = new Map();
  memory.edges = [];
  memory.fullAt = 0;
}

/**
 * Between full runs only items that are new or whose text changed are examined. A full run is forced
 * at least this often (default one hour), because a link whose evidence sits in an unchanged item's
 * text, naming a newly created item, is only found by a run that reads everything again.
 */
const fullRefreshMs = (): number => Number(process.env.INFERENCE_FULL_REFRESH_MS ?? 60 * 60_000);

/** Everything about an item that the inference prompt shows, so a changed fingerprint means the answer may change. */
const fingerprint = (item: WorkItem): string =>
  createHash("sha1")
    .update(JSON.stringify([item.title, item.parent?.title ?? null, item.scope ?? null, item.lastActivityNote ?? null]))
    .digest("hex");

const fullRow = (item: WorkItem): string =>
  `- id="${item.id}" | title="${item.title}"${item.parent ? ` | initiative="${item.parent.title}"` : ""}${item.scope ? ` | scope="${item.scope}"` : ""}${item.lastActivityNote ? ` | latest note="${item.lastActivityNote}"` : ""}`;

const titleRow = (item: WorkItem): string => `- id="${item.id}" | title="${item.title}"`;

const pairKey = (edge: DependencyEdge): string => `${edge.blockerId}>${edge.blockedId}`;
const withoutEvidence = (edges: RememberedEdge[]): DependencyEdge[] =>
  edges.map((edge) => {
    const plain: DependencyEdge = { ...edge };
    delete (plain as Partial<RememberedEdge>).evidenceId;
    return plain;
  });

/**
 * AI-inferred dependencies from the scope and latest note of open items, whether or not a source
 * also states a link. This is a separate, lower-confidence signal by design (see
 * DependencyEdge.confidence), never merged into the same certainty as a connector's own
 * relationship links. A failed call returns the links remembered from the last good run (empty if
 * there is none) rather than breaking the page, matching the fallback pattern used throughout
 * this codebase.
 *
 * The first run, and one run an hour, reads every open item. Runs in between examine only items
 * that are new or whose text changed (full text), show every other open item by title only as a
 * possible counterpart, and reuse the remembered links whose justifying text did not change.
 */
export async function inferDependencyEdges(workItems: WorkItem[]): Promise<DependencyEdge[]> {
  const openItems = workItems.filter((item) => !item.isDone);
  if (openItems.length < 2) return [];

  const openIds = new Set(openItems.map((i) => i.id));
  const current = new Map(openItems.map((item) => [item.id, fingerprint(item)]));
  const now = Date.now();
  const full = memory.fullAt === 0 || now - memory.fullAt >= fullRefreshMs();
  const examined = full ? openItems : openItems.filter((item) => memory.fingerprints.get(item.id) !== current.get(item.id));
  const examinedIds = new Set(examined.map((i) => i.id));
  const stillOpen = (edge: RememberedEdge) => openIds.has(edge.blockerId) && openIds.has(edge.blockedId);
  const retained = full ? [] : memory.edges.filter((edge) => stillOpen(edge) && !examinedIds.has(edge.evidenceId));

  if (examined.length === 0) {
    inferenceMeter.reusedRebuilds += 1;
    memory.edges = retained;
    memory.fingerprints = current;
    return withoutEvidence(retained);
  }

  const others = full ? [] : openItems.filter((item) => !examinedIds.has(item.id));
  const prompt = `Below are open work items from a team's task/CRM systems. Some may implicitly depend on each other even though no formal link exists between them — e.g. one item's scope or latest note mentions waiting on, or being blocked by, something another item is doing.

Only report a dependency you can actually justify from the text (scope or note) — do not invent plausible-sounding relationships from titles alone. It is completely fine to return zero edges if nothing in the text supports one.

${full ? "Items" : "Items to examine (full text)"}:
${examined.map(fullRow).join("\n")}
${
  full
    ? ""
    : `
Other open items (id and title only, as possible counterparts; their own text is not shown):
${others.map(titleRow).join("\n")}

Report only links justified by the text of one of the items to examine. A link may connect an item to examine with any open item listed above.
`
}
For each real dependency you find, return the blocking item's id, the blocked item's id, the id of the item whose text justifies it (one of those two), and a short note (under 200 characters) quoting or paraphrasing the specific text that justifies it.`;

  inferenceMeter.calls += 1;
  if (!full) inferenceMeter.incrementalCalls += 1;
  inferenceMeter.lastItemCount = examined.length;
  try {
    const model = anthropic(process.env.AI_INSIGHTS_MODEL || "claude-sonnet-5");
    const result = await generateText({
      model,
      output: Output.object({ schema: inferenceSchema }),
      prompt,
      providerOptions: { anthropic: { effort: "low" } },
    });
    inferenceMeter.inputTokens += result.usage.inputTokens ?? 0;
    inferenceMeter.outputTokens += result.usage.outputTokens ?? 0;

    const fresh: RememberedEdge[] = result.output.edges
      .filter((e) => openIds.has(e.blockerId) && openIds.has(e.blockedId) && e.blockerId !== e.blockedId)
      .map((e) => ({
        blockerId: e.blockerId,
        blockedId: e.blockedId,
        confidence: "inferred" as const,
        note: e.note,
        evidenceId: e.evidenceId === e.blockerId || e.evidenceId === e.blockedId ? e.evidenceId : e.blockedId,
      }))
      // A link justified by text the model was not shown cannot have come from that text.
      .filter((e) => examinedIds.has(e.evidenceId));

    const seen = new Set<string>();
    const merged = [...retained, ...fresh].filter((edge) => !seen.has(pairKey(edge)) && seen.add(pairKey(edge)));
    memory.edges = merged;
    memory.fingerprints = current;
    if (full) memory.fullAt = now;
    return withoutEvidence(merged);
  } catch (error) {
    inferenceMeter.failures += 1;
    inferenceMeter.lastFailure = describeFailure(error);
    // Memory stays as it was, so the next rebuild examines the same items again.
    return withoutEvidence(memory.edges.filter(stillOpen));
  }
}

export interface MergedDependencyEdges {
  /** Confirmed edges from every connector, plus any promoted override. */
  confirmedEdges: DependencyEdge[];
  /** Inferred edges minus anything already promoted — a promoted link shouldn't linger as a note asking to verify it again. */
  inferredEdges: DependencyEdge[];
}

/**
 * Merges a run's raw confirmed/inferred edges with an operator's past promotions
 * (see lib/dependency-overrides.ts). Pulled out as its own pure function so
 * the override interaction — the actual point of "promote to confirmed" —
 * is unit-testable without a live AI key or a running dev server, since
 * `inferDependencyEdges` normally requires both.
 */
export function mergeDependencyEdges(
  confirmedFromConnectors: DependencyEdge[],
  inferredFromAi: DependencyEdge[],
  overrides: DependencyEdge[],
): MergedDependencyEdges {
  const isPromoted = (edge: DependencyEdge) =>
    overrides.some((o) => o.blockerId === edge.blockerId && o.blockedId === edge.blockedId);

  return {
    confirmedEdges: [...confirmedFromConnectors, ...overrides],
    inferredEdges: inferredFromAi.filter((edge) => !isPromoted(edge)),
  };
}

export interface InferredLink {
  blockerId: string;
  blockedId: string;
  blockedTitle: string;
  note: string;
}

/**
 * Every inferred edge where `blockerId` is the given item, resolved to a
 * displayable, actionable shape — everything priority-list.tsx and
 * bottleneck-list.tsx need to render a note *and* a "Confirm this link"
 * button (see lib/actions/dependencies.ts) without recomputing this lookup
 * in three places.
 */
export function inferredLinksFor(
  blockerId: string,
  inferredEdges: DependencyEdge[],
  workItemsById: Map<string, WorkItem>,
): InferredLink[] {
  const links: InferredLink[] = [];
  for (const edge of inferredEdges) {
    if (edge.blockerId !== blockerId) continue;
    const blocked = workItemsById.get(edge.blockedId);
    if (!blocked) continue;
    links.push({ blockerId, blockedId: edge.blockedId, blockedTitle: blocked.title, note: edge.note ?? "" });
  }
  return links;
}
