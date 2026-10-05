/**
 * Canonical domain model. Every connector adapter maps its source's own
 * shape into these types — nothing downstream (rules, ranking, UI) ever
 * looks at a source-specific field again. `source` is a plain string, not a
 * closed enum: adding HubSpot or Monday.com later is a new adapter, not a
 * type change here.
 */

export type SourceSystem = string;

export interface SourceRef {
  source: SourceSystem;
  externalId: string;
}

export interface Person {
  /** Canonical id: `${source}:${externalId}` of the identity that created this record. A person seen in two sources with the same email is merged by the registry, not here. */
  id: string;
  name: string;
  email?: string | null;
  sourceRefs: SourceRef[];
  /**
   * Fully-loaded cost per hour, when the org tracks one — the input to any
   * derived cost-of-delay figure (see MANIFESTO.md). Never displayed raw in
   * the UI; only ever used inside a computed aggregate. Optional and usually
   * absent — most sources won't expose this, and the app must not guess it.
   */
  costRatePerHour?: number | null;
}

export type RagLevel = "red" | "amber" | "green";

export interface SeverityResult {
  level: RagLevel;
  reason: string;
}

export interface WorkItem {
  /** Canonical id: `${source}:${externalId}`. */
  id: string;
  source: SourceSystem;
  externalId: string;
  title: string;
  /** The source's own status label, kept for display. */
  status: string;
  /** Normalized by the connector — every adapter decides what "done" means in its own system. True means "no longer needs action", which includes abandoned work; see `outcome`. */
  isDone: boolean;
  /**
   * How a finished item ended: "delivered" (the work was done) or "abandoned"
   * (dropped, canceled, won't-do). Only meaningful when `isDone`. Null on an
   * open item. Undefined means the source does not distinguish the two, so the
   * app treats a finished item as delivered, as it did before this field
   * existed. A connector must not guess: set it only when the source itself
   * separates the outcomes. The values are deliberately generic; the mapping
   * from a given organization's own status names is the adapter's job.
   */
  outcome?: "delivered" | "abandoned" | null;
  assignee: Person | null;
  /** The initiative/project/epic/account this item rolls up to, when the source models one. */
  parent?: { id: string; title: string } | null;
  /** Free-text description of what "done" requires, when the source exposes one — the substrate for the commitment-vs-delivery check. */
  scope?: string | null;
  team?: string | null;
  url: string;
  dueDateMs: number | null;
  createdMs: number | null;
  closedMs: number | null;
  updatedMs: number | null;
  /** Most recent comment/update text, when available. */
  lastActivityNote?: string | null;
  /**
   * Standardized task type/category (e.g. "bug fix", "content draft",
   * "contract review") — required for comparing this item's duration against
   * historical instances of the same kind of work. Null when the source has
   * no taxonomy; the app must not invent one from the title.
   */
  category?: string | null;
  /** Actual logged time so far, from the source's own time-tracking feature. Null (not 0) when the source has no time tracking configured — see MANIFESTO.md. */
  timeTrackedMs?: number | null;
  /** The source's own estimate, when it has one. Historical comparison (typical duration for this `category`) is computed from past `timeTrackedMs`/`closedMs` values, not stored here. */
  estimatedDurationMs?: number | null;
}

export type DependencyConfidence = "confirmed" | "inferred";

export interface DependencyEdge {
  /** The item that must finish first. */
  blockerId: string;
  /** The item waiting on it. */
  blockedId: string;
  /**
   * "confirmed" comes only from a source's own relationship data (ClickUp
   * task links, Salesforce related records, etc.) — ground truth. "inferred"
   * comes from the AI reading task text and is a separate, lower-confidence
   * signal that must never be presented with the same certainty as a
   * confirmed edge. See lib/rules/dependencies.ts.
   */
  confidence: DependencyConfidence;
  /**
   * Why the model believes this edge exists. Normally present only on an
   * "inferred" edge — but also kept on a "confirmed" one that started as an
   * inferred edge an operator verified (see lib/dependency-overrides.ts), as an
   * audit trail of what justified promoting it.
   */
  note?: string;
}

export interface WorkloadSnapshot {
  personId: string;
  capturedAtMs: number;
  openCount: number;
  overdueCount: number;
  closedLast7d: number;
  /** How many of this person's open items are a confirmed blocker for someone else's work. */
  blockingOthersCount: number;
}

/** One Jev judgment: a probability for each ordered level, plus the model's confidence in that distribution. */
export interface DimensionEstimate {
  /** Probability of each level, index = level. Sums to 1. */
  probabilities: number[];
  /** 0 to 1, from how concentrated the distribution is (TypeSafe's definition). */
  confidence: number;
}

/** What the probabilistic ranking adds to an entry. Model estimates, not calibrated on real outcomes. */
export interface ProbabilisticDetail {
  /** Mean rank over the simulation runs (1 = first). The ordering key. */
  expectedRank: number;
  /** Chance of landing at each rank, index 0 = rank 1. Sums to 1. */
  rankProbabilities: number[];
  pTop1: number;
  pTop3: number;
  /** Lowest confidence among this item's Jev dimensions. */
  confidence: number;
  leverage: DimensionEstimate;
  slipRisk: DimensionEstimate;
  /** Items whose expected ranks are statistically indistinguishable share a group id; null when not tied. */
  tieGroup: string | null;
  /** True when the operator has not yet chosen the order inside this item's tie group. */
  needsDecision: boolean;
}

export interface PriorityRankingEntry {
  workItemId: string;
  rank: number;
  /** Rule-based weight. Absent on probabilistic entries: the probabilities replace it, and showing both would contradict. */
  score?: number;
  reasoning: string;
  /** Person ids whose work is unblocked once this item ships. */
  releasesWorkFor: string[];
  source: "ai" | "rule-based" | "probabilistic";
  probabilistic?: ProbabilisticDetail;
  /**
   * Present when the model was not asked about this item because there were more open items
   * than one pass may ask about. It is ordered by exact facts only and sits below every
   * assessed item, with no rank probabilities. `guaranteedTop` is how many top positions
   * could not change even if every item had been assessed.
   */
  unassessed?: { assessed: number; total: number; guaranteedTop: number };
}
