import type { DimensionEstimate, PriorityRankingEntry } from "../types";
import type { WorkItemFact } from "./facts";

/**
 * Probabilistic ranking. Pure code, no model calls: it takes the per-item
 * probability distributions that Jev returned (Leverage and Slip risk) plus
 * the deterministic facts, samples the distributions many times, ranks the
 * items in every sample, and reports for each item the chance of landing at
 * each rank. Items are ordered by expected (mean) rank.
 *
 * Design and decisions: DESIGN_PROBABILISTIC_RANKING.md. The weights are
 * judgment values chosen by the operator on 2026-10-01, not derived from data.
 */

export const WEIGHTS = {
  severity: 0.25,
  leverage: 0.2,
  releases: 0.15,
  slipRisk: 0.15,
  replan: 0.15,
  dueSoon: 0.1,
} as const;
// Owner load has weight 0 by decision: it stays a flag in the facts, not a score input.

/** Jev levels run 0 to 4 for both questions. */
export const JEV_LEVELS = 5;
const TOP_LEVEL = JEV_LEVELS - 1;

export const LEVEL_LABELS = {
  leverage: ["nothing waits on it", "marginal", "moderate", "significant", "critical"],
  slipRisk: ["healthy", "quiet", "uncertain", "at risk", "stalled or failing"],
} as const;

const SEVERITY_VALUE = { red: 1, amber: 0.5, green: 0.1 } as const;
const RELEASES_CAP = 3;
const DUE_SOON_DAYS = 7;
export const DEFAULT_RUNS = 2000;
/** Two items are tied when their paired rank difference is within this many standard errors of zero. */
const TIE_Z = 2;
const EPS = 1e-9;

export interface ItemJudgment {
  leverage: DimensionEstimate;
  slipRisk: DimensionEstimate;
}

export interface SimulationOptions {
  runs?: number;
  /** Seed for the random generator. Defaults to a hash of the inputs, so identical inputs give identical output. */
  seed?: string;
  /**
   * The operator's decisions: each entry lists one tie group's exact members in the order the operator chose.
   * A decision applies only to a tie group with exactly those members.
   */
  operatorOrder?: string[][];
  /** Builds the one-line reasoning for an entry. Deterministic by decision (no model narration in v1). */
  describe: (fact: WorkItemFact, judgment: ItemJudgment) => string;
}

/** Everything in the index that is known exactly, as a 0..1-normalized weighted sum. */
export function fixedIndex(fact: WorkItemFact): number {
  const severity = SEVERITY_VALUE[fact.severity.level];
  const releases = Math.min(fact.releasesWorkForNames.length, RELEASES_CAP) / RELEASES_CAP;
  const replan = fact.abandonedBlockers.length > 0 ? 1 : 0;
  const days = fact.daysUntilDue;
  const dueSoon = days == null ? 0 : days <= 0 ? 1 : days >= DUE_SOON_DAYS ? 0 : (DUE_SOON_DAYS - days) / DUE_SOON_DAYS;
  return (
    WEIGHTS.severity * severity + WEIGHTS.releases * releases + WEIGHTS.replan * replan + WEIGHTS.dueSoon * dueSoon
  );
}

/** The most the two Jev dimensions can add to an item's index: the best possible answer on both. */
export const MAX_JEV_CONTRIBUTION = WEIGHTS.leverage + WEIGHTS.slipRisk;

export interface AssessmentSelection {
  /** Items to ask the model about, best exact facts first. */
  assessed: WorkItemFact[];
  /** The rest, best exact facts first. They are ranked below every assessed item. */
  unassessed: WorkItemFact[];
  /** How many top positions provably cannot change if the rest were assessed too. */
  guaranteedTop: number;
}

/**
 * Chooses which items the model is asked about when there are more open items
 * than `cap`. Items are ordered by what is known exactly (`fixedIndex`), with
 * ties broken by how many unconfirmed dependency hints they carry, then by id.
 * The first `cap` are assessed.
 *
 * Why the top of the list is still trustworthy: the model can add at most
 * MAX_JEV_CONTRIBUTION to an item's index and never subtracts. So an item whose
 * exact score plus that maximum is still below the k-th best exact score has at
 * least k items above it however the model answers, and cannot be in the top k.
 * `guaranteedTop` is the largest k (up to `wantedTop`) for which every item that
 * could still reach the top k is among the assessed ones. Below that point, an
 * unassessed item might truly belong above an assessed one.
 */
export function selectForAssessment(facts: WorkItemFact[], cap: number, wantedTop: number): AssessmentSelection {
  if (facts.length <= cap) return { assessed: facts, unassessed: [], guaranteedTop: facts.length };

  const ordered = facts
    .map((fact) => ({ fact, exact: fixedIndex(fact) }))
    .sort(
      (a, b) =>
        b.exact - a.exact ||
        b.fact.inferredBlockingNotes.length - a.fact.inferredBlockingNotes.length ||
        a.fact.item.id.localeCompare(b.fact.item.id),
    );

  // Number of items that could still reach the top k, as k shrinks the bar rises and the count falls.
  const contenders = (k: number): number => {
    const bar = ordered[k - 1].exact - MAX_JEV_CONTRIBUTION - EPS;
    let count = 0;
    while (count < ordered.length && ordered[count].exact >= bar) count++;
    return count;
  };
  let guaranteedTop = Math.min(wantedTop, cap, ordered.length);
  while (guaranteedTop > 0 && contenders(guaranteedTop) > cap) guaranteedTop--;

  return {
    assessed: ordered.slice(0, cap).map((o) => o.fact),
    unassessed: ordered.slice(cap).map((o) => o.fact),
    guaranteedTop,
  };
}

/** Checks a Jev answer and normalizes tiny rounding drift. Throws on anything unusable so the caller can fall back whole. */
export function validateEstimate(estimate: DimensionEstimate, name: string): DimensionEstimate {
  const { probabilities, confidence } = estimate;
  if (probabilities.length !== JEV_LEVELS || probabilities.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new Error(`Invalid ${name} probabilities`);
  }
  const sum = probabilities.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.01) throw new Error(`${name} probabilities sum to ${sum}, expected 1`);
  if (!Number.isFinite(confidence)) throw new Error(`Invalid ${name} confidence`);
  return { probabilities: probabilities.map((p) => p / sum), confidence };
}

/** FNV-1a: a small, stable string hash for seeding. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cumulative(probabilities: number[]): number[] {
  let running = 0;
  return probabilities.map((p) => (running += p));
}

function sampleLevel(cdf: number[], u: number): number {
  for (let level = 0; level < cdf.length; level++) if (u < cdf[level]) return level;
  return cdf.length - 1;
}

export function rankProbabilistically(
  facts: WorkItemFact[],
  judgments: Map<string, ItemJudgment>,
  options: SimulationOptions,
): PriorityRankingEntry[] {
  const n = facts.length;
  if (n === 0) return [];
  const runs = options.runs ?? DEFAULT_RUNS;

  const checked = facts.map((fact) => {
    const raw = judgments.get(fact.item.id);
    if (!raw) throw new Error(`No Jev judgment for ${fact.item.id}`);
    return {
      leverage: validateEstimate(raw.leverage, `${fact.item.id} leverage`),
      slipRisk: validateEstimate(raw.slipRisk, `${fact.item.id} slip risk`),
    };
  });
  const fixed = facts.map(fixedIndex);
  const leverageCdf = checked.map((c) => cumulative(c.leverage.probabilities));
  const slipCdf = checked.map((c) => cumulative(c.slipRisk.probabilities));

  const seedText =
    options.seed ??
    JSON.stringify([facts.map((f) => f.item.id), fixed, checked.map((c) => [c.leverage.probabilities, c.slipRisk.probabilities])]);
  const random = seededRandom(hashString(seedText));

  // ranks[run * n + item] is the item's rank in that run, 1-based; equal indexes share the average of the positions they occupy.
  const ranks = new Float64Array(runs * n);
  const counts = Array.from({ length: n }, () => new Float64Array(n));
  const index = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);

  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < n; i++) {
      const lev = sampleLevel(leverageCdf[i], random());
      const slip = sampleLevel(slipCdf[i], random());
      index[i] = fixed[i] + (WEIGHTS.leverage * lev) / TOP_LEVEL + (WEIGHTS.slipRisk * slip) / TOP_LEVEL;
    }
    order.sort((a, b) => index[b] - index[a] || a - b);
    let start = 0;
    while (start < n) {
      let end = start + 1;
      while (end < n && Math.abs(index[order[end]] - index[order[start]]) < EPS) end++;
      const size = end - start;
      const sharedRank = start + 1 + (size - 1) / 2;
      for (let k = start; k < end; k++) {
        ranks[run * n + order[k]] = sharedRank;
        for (let p = start; p < end; p++) counts[order[k]][p] += 1 / size;
      }
      start = end;
    }
  }

  const mean = new Float64Array(n);
  for (let run = 0; run < runs; run++) for (let i = 0; i < n; i++) mean[i] += ranks[run * n + i];
  for (let i = 0; i < n; i++) mean[i] /= runs;

  // Order by expected rank; the id only makes the sort deterministic.
  const byMean = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => mean[a] - mean[b] || facts[a].item.id.localeCompare(facts[b].item.id),
  );

  const indistinguishable = (a: number, b: number): boolean => {
    let sum = 0;
    let sumSq = 0;
    for (let run = 0; run < runs; run++) {
      const d = ranks[run * n + a] - ranks[run * n + b];
      sum += d;
      sumSq += d * d;
    }
    const meanDiff = sum / runs;
    const variance = Math.max(0, sumSq / runs - meanDiff * meanDiff);
    const standardError = Math.sqrt(variance / runs);
    return Math.abs(meanDiff) <= TIE_Z * standardError + 1e-12;
  };

  // Chain neighbours in expected-rank order into tie groups.
  const groups: number[][] = [];
  for (const item of byMean) {
    const current = groups[groups.length - 1];
    if (current && indistinguishable(current[current.length - 1], item)) current.push(item);
    else groups.push([item]);
  }

  const ordered: { item: number; tieGroup: string | null }[] = [];
  groups.forEach((group, groupIndex) => {
    // Default order inside a tie group is by id; the operator's choice is applied afterwards.
    const members = group.length === 1 ? group : [...group].sort((a, b) => facts[a].item.id.localeCompare(facts[b].item.id));
    for (const item of members) ordered.push({ item, tieGroup: group.length === 1 ? null : `tie-${groupIndex + 1}` });
  });

  const entries = ordered.map(({ item, tieGroup }, position) => {
    const fact = facts[item];
    const probabilities = Array.from(counts[item], (c) => c / runs);
    return {
      workItemId: fact.item.id,
      rank: position + 1,
      reasoning: options.describe(fact, checked[item]),
      releasesWorkFor: fact.releasesWorkForNames,
      source: "probabilistic" as const,
      probabilistic: {
        expectedRank: mean[item],
        rankProbabilities: probabilities,
        pTop1: probabilities[0],
        pTop3: probabilities.slice(0, 3).reduce((a, b) => a + b, 0),
        confidence: Math.min(checked[item].leverage.confidence, checked[item].slipRisk.confidence),
        leverage: checked[item].leverage,
        slipRisk: checked[item].slipRisk,
        tieGroup,
        needsDecision: tieGroup != null,
      },
    };
  });
  return applyOperatorOrder(entries, options.operatorOrder ?? []);
}

/** A stable key for a set of item ids, so a decision can be matched to a tie group with exactly the same members. */
export const memberKey = (ids: string[]): string => [...ids].sort().join("\u0000");

/**
 * Applies the operator's chosen order inside each tie group, and nowhere else:
 * an item never moves outside its group, and no probability changes. A decision
 * is used only when its members are exactly the group's members. Tie groups
 * are recomputed on every ranking pass and their membership changes between
 * passes, so a choice made about one set of items must not stand in for a
 * choice nobody made about a different set. A group with no matching decision
 * keeps its default order and keeps asking. Cheap and pure, so it can be
 * applied at read time on a cached ranking.
 */
export function applyOperatorOrder(entries: PriorityRankingEntry[], decisions: string[][]): PriorityRankingEntry[] {
  if (decisions.length === 0 || !entries.some((e) => e.probabilistic?.tieGroup)) return entries;
  // A later decision for the same members replaces an earlier one.
  const byMembers = new Map(decisions.map((decision) => [memberKey(decision), decision]));
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  const result: PriorityRankingEntry[] = [];
  let i = 0;
  while (i < sorted.length) {
    const group = sorted[i].probabilistic?.tieGroup ?? null;
    if (group == null) {
      result.push(sorted[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < sorted.length && sorted[j].probabilistic?.tieGroup === group) j++;
    const members = sorted.slice(i, j);
    const decision = byMembers.get(memberKey(members.map((m) => m.workItemId)));
    const position = decision ? new Map(decision.map((id, index) => [id, index])) : null;
    const reordered = position ? [...members].sort((a, b) => position.get(a.workItemId)! - position.get(b.workItemId)!) : members;
    reordered.forEach((m, k) => result.push({ ...m, rank: i + k + 1, probabilistic: { ...m.probabilistic!, needsDecision: !decision } }));
    i = j;
  }
  return result;
}
