import { describe, expect, it, vi } from "vitest";
import { clearJevCache, rankWorkItemsProbabilistic, resetJevMeter } from "./jev";
import { createDemoAsk } from "./jev-demo";
import { MAX_JEV_CONTRIBUTION, fixedIndex, seededRandom, selectForAssessment } from "./probabilistic";
import type { WorkItemFact } from "./facts";
import type { WorkItem } from "../types";

/**
 * A synthetic company: many open items with a realistic mix. Most are on track
 * with nothing special about them, a minority are late, a few unblock people or
 * wait on dropped work. Invented, only for checking that the shortlist logic
 * behaves at the size of a real workspace.
 */
function syntheticFacts(count: number, seed: number): WorkItemFact[] {
  const random = seededRandom(seed);
  const notes = [
    undefined,
    undefined,
    undefined,
    "Waiting on the client to confirm the scope.",
    "Blocked until the contract is signed.",
    "In progress, on track.",
    "Stalled: owner is out this week.",
  ];
  return Array.from({ length: count }, (_, i) => {
    const roll = random();
    const level = roll < 0.12 ? "red" : roll < 0.4 ? "amber" : "green";
    const daysUntilDue = level === "red" ? -(8 + Math.floor(random() * 20)) : level === "amber" ? -(1 + Math.floor(random() * 6)) : Math.floor(random() * 30) - 2;
    const released = random() < 0.12 ? 1 + Math.floor(random() * 3) : 0;
    const item: WorkItem = {
      id: `syn:${i}`,
      source: "syn",
      externalId: String(i),
      title: `Synthetic item ${i}`,
      status: "open",
      isDone: false,
      assignee: null,
      url: "https://example.com",
      dueDateMs: null,
      createdMs: null,
      closedMs: null,
      updatedMs: null,
      lastActivityNote: notes[Math.floor(random() * notes.length)],
    };
    return {
      item,
      severity: { level, reason: level === "green" ? "On track" : "late" },
      releasesWorkForNames: Array.from({ length: released }, (_, k) => `Person ${k}`),
      inferredBlockingNotes: random() < 0.05 ? ["may be blocking something"] : [],
      ownerOpenCount: null,
      ownerOverdueCount: null,
      daysUntilDue,
      abandonedBlockers: random() < 0.03 ? [{ title: "Dropped work", note: null }] : [],
      abandonedTrackedMs: null,
    } satisfies WorkItemFact;
  });
}

describe("selectForAssessment", () => {
  it("assesses everything when the items fit under the cap", () => {
    const facts = syntheticFacts(30, 1);
    const selection = selectForAssessment(facts, 40, 20);
    expect(selection.assessed).toHaveLength(30);
    expect(selection.unassessed).toEqual([]);
    expect(selection.guaranteedTop).toBe(30);
  });

  it("takes the best items by exact facts, and splits every item exactly once", () => {
    const facts = syntheticFacts(500, 2);
    const { assessed, unassessed } = selectForAssessment(facts, 40, 20);
    expect(assessed).toHaveLength(40);
    expect(assessed.length + unassessed.length).toBe(500);
    expect(new Set([...assessed, ...unassessed].map((f) => f.item.id)).size).toBe(500);
    const worstAssessed = Math.min(...assessed.map(fixedIndex));
    expect(unassessed.every((f) => fixedIndex(f) <= worstAssessed + 1e-12)).toBe(true);
  });

  it("promises a top-k only when no unassessed item could reach it, however the model answers", () => {
    for (const seed of [3, 4, 5, 6, 7]) {
      const facts = syntheticFacts(400, seed);
      const { unassessed, guaranteedTop } = selectForAssessment(facts, 40, 20);
      if (guaranteedTop === 0) continue;
      const exact = facts.map(fixedIndex).sort((a, b) => b - a);
      const kthBest = exact[guaranteedTop - 1];
      // Even the best possible model answer cannot lift an unassessed item to the k-th best exact score.
      for (const fact of unassessed) expect(fixedIndex(fact) + MAX_JEV_CONTRIBUTION).toBeLessThan(kthBest + 1e-9);
    }
  });

  it("promises nothing when too many items could still reach the top", () => {
    // Every item has identical exact facts, so any of them could end up first.
    const template = syntheticFacts(1, 10)[0];
    const facts = Array.from({ length: 100 }, (_, i) => ({ ...template, item: { ...template.item, id: `same:${i}` } }));
    expect(selectForAssessment(facts, 40, 20).guaranteedTop).toBe(0);
  });

  it("breaks ties among equal exact facts by unconfirmed hints, then by id", () => {
    const base = syntheticFacts(1, 11)[0];
    const make = (id: string, hints: number): WorkItemFact => ({
      ...base,
      item: { ...base.item, id },
      inferredBlockingNotes: Array.from({ length: hints }, () => "hint"),
    });
    const facts = [make("b", 0), make("a", 0), make("z", 2), make("m", 1)];
    const { assessed } = selectForAssessment(facts, 3, 2);
    expect(assessed.map((f) => f.item.id)).toEqual(["z", "m", "a"]);
  });
});

describe("a workspace far larger than the cap", () => {
  it("asks the model about no more than the cap, and still ranks every item exactly once", async () => {
    clearJevCache();
    resetJevMeter();
    const facts = syntheticFacts(300, 21);
    const demo = createDemoAsk();
    const ask = vi.fn(demo);
    const ranked = await rankWorkItemsProbabilistic(facts, { ask, maxItems: 40, namespace: "scale-a", runs: 300 });
    expect(ask).toHaveBeenCalledTimes(40);
    expect(ranked).toHaveLength(300);
    expect(ranked!.map((r) => r.rank)).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    expect(new Set(ranked!.map((r) => r.workItemId)).size).toBe(300);
    expect(ranked!.slice(0, 40).every((r) => r.probabilistic && !r.unassessed)).toBe(true);
    expect(ranked!.slice(40).every((r) => !r.probabilistic && r.unassessed)).toBe(true);
  });

  it("gives the guaranteed top positions the same expected ranks as assessing every item", async () => {
    clearJevCache();
    // A few items with overwhelming exact facts (late, many people waiting, needs re-planning), and nothing else close.
    const facts = syntheticFacts(300, 22).map((fact, i): WorkItemFact => {
      if (i < 5) {
        return {
          ...fact,
          severity: { level: "red", reason: "late" },
          daysUntilDue: -9,
          releasesWorkForNames: ["A", "B", "C"],
          abandonedBlockers: [{ title: "Dropped work", note: null }],
        };
      }
      return {
        ...fact,
        severity: fact.severity.level === "red" ? { level: "amber", reason: "late" } : fact.severity,
        releasesWorkForNames: fact.releasesWorkForNames.slice(0, 1),
        abandonedBlockers: [],
      };
    });
    const demo = createDemoAsk();
    const capped = await rankWorkItemsProbabilistic(facts, { ask: demo, maxItems: 60, namespace: "scale-b", runs: 3000 });
    const guaranteed = capped!.find((r) => r.unassessed)!.unassessed!.guaranteedTop;
    expect(guaranteed).toBe(5);
    const full = await rankWorkItemsProbabilistic(facts, { ask: demo, maxItems: 300, namespace: "scale-b", runs: 3000 });
    const fullById = new Map(full!.map((r) => [r.workItemId, r]));
    for (const entry of capped!.slice(0, guaranteed)) {
      const other = fullById.get(entry.workItemId)!;
      expect(Math.abs(entry.probabilistic!.expectedRank - other.probabilistic!.expectedRank)).toBeLessThan(0.3);
    }
    // And no item the full run puts in those positions was left unassessed.
    const topFull = full!.slice(0, guaranteed).map((r) => r.workItemId);
    const assessedIds = new Set(capped!.filter((r) => !r.unassessed).map((r) => r.workItemId));
    expect(topFull.every((id) => assessedIds.has(id))).toBe(true);
  });

  it("often cannot promise any position in a typical mix, which is why the page says so", () => {
    const { guaranteedTop } = selectForAssessment(syntheticFacts(300, 22), 60, 20);
    expect(guaranteedTop).toBe(0);
  });
});
