import { describe, expect, it } from "vitest";
import {
  applyOperatorOrder,
  fixedIndex,
  hashString,
  rankProbabilistically,
  seededRandom,
  validateEstimate,
  WEIGHTS,
  type ItemJudgment,
} from "./probabilistic";
import type { WorkItemFact } from "./facts";
import type { DimensionEstimate, WorkItem } from "../types";

function makeFact(id: string, overrides: Partial<WorkItemFact> = {}): WorkItemFact {
  const item: WorkItem = {
    id,
    source: "test",
    externalId: id,
    title: id,
    status: "open",
    isDone: false,
    assignee: null,
    url: "https://example.com",
    dueDateMs: null,
    createdMs: null,
    closedMs: null,
    updatedMs: null,
  };
  return {
    item,
    severity: { level: "green", reason: "On track" },
    releasesWorkForNames: [],
    inferredBlockingNotes: [],
    ownerOpenCount: null,
    ownerOverdueCount: null,
    daysUntilDue: null,
    abandonedBlockers: [],
    abandonedTrackedMs: null,
    ...overrides,
  };
}

/** A distribution that puts all probability on one level. */
const certain = (level: number): DimensionEstimate => ({
  probabilities: [0, 0, 0, 0, 0].map((_, i) => (i === level ? 1 : 0)),
  confidence: 1,
});
const uniform = (): DimensionEstimate => ({ probabilities: [0.2, 0.2, 0.2, 0.2, 0.2], confidence: 0 });
const judgment = (leverage: DimensionEstimate, slipRisk: DimensionEstimate = certain(0)): ItemJudgment => ({ leverage, slipRisk });
const describe_ = () => "reason";
const opts = { describe: describe_ };

describe("weights", () => {
  it("sum to 1", () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("fixedIndex", () => {
  it("is 0.025 for a green item with nothing else (severity 0.1 x 0.25)", () => {
    expect(fixedIndex(makeFact("a"))).toBeCloseTo(0.025, 10);
  });

  it("caps confirmed releases at three people", () => {
    const three = fixedIndex(makeFact("a", { releasesWorkForNames: ["x", "y", "z"] }));
    const five = fixedIndex(makeFact("b", { releasesWorkForNames: ["x", "y", "z", "p", "q"] }));
    expect(five).toBeCloseTo(three, 10);
    expect(three - fixedIndex(makeFact("c"))).toBeCloseTo(WEIGHTS.releases, 10);
  });

  it("scales due-soon linearly: full at due today or overdue, none at 7 days or more", () => {
    const base = fixedIndex(makeFact("c"));
    expect(fixedIndex(makeFact("a", { daysUntilDue: 0 })) - base).toBeCloseTo(WEIGHTS.dueSoon, 10);
    expect(fixedIndex(makeFact("a", { daysUntilDue: -3 })) - base).toBeCloseTo(WEIGHTS.dueSoon, 10);
    expect(fixedIndex(makeFact("a", { daysUntilDue: 7 })) - base).toBeCloseTo(0, 10);
    expect(fixedIndex(makeFact("a", { daysUntilDue: 30 })) - base).toBeCloseTo(0, 10);
    expect(fixedIndex(makeFact("a", { daysUntilDue: null })) - base).toBeCloseTo(0, 10);
  });

  it("adds the re-plan weight when waiting on abandoned work", () => {
    const flagged = fixedIndex(makeFact("a", { abandonedBlockers: [{ title: "t", note: null }] }));
    expect(flagged - fixedIndex(makeFact("b"))).toBeCloseTo(WEIGHTS.replan, 10);
  });

  it("ignores owner load entirely (flag only, by decision)", () => {
    expect(fixedIndex(makeFact("a", { ownerOpenCount: 40, ownerOverdueCount: 20 }))).toBeCloseTo(fixedIndex(makeFact("b")), 10);
  });
});

describe("validateEstimate", () => {
  it("normalizes small drift", () => {
    const fixed = validateEstimate({ probabilities: [0.2, 0.2, 0.2, 0.2, 0.2005], confidence: 0.1 }, "x");
    expect(fixed.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("rejects wrong length, negatives, bad sums and bad confidence", () => {
    expect(() => validateEstimate({ probabilities: [1, 0], confidence: 1 }, "x")).toThrow();
    expect(() => validateEstimate({ probabilities: [1.5, -0.5, 0, 0, 0], confidence: 1 }, "x")).toThrow();
    expect(() => validateEstimate({ probabilities: [0.5, 0, 0, 0, 0], confidence: 1 }, "x")).toThrow();
    expect(() => validateEstimate({ probabilities: [1, 0, 0, 0, 0], confidence: Number.NaN }, "x")).toThrow();
  });
});

describe("seeded random", () => {
  it("is reproducible and stays in [0, 1)", () => {
    const a = seededRandom(hashString("seed"));
    const b = seededRandom(hashString("seed"));
    const xs = Array.from({ length: 5 }, a);
    expect(xs).toEqual(Array.from({ length: 5 }, b));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("rankProbabilistically", () => {
  it("gives certain rankings probability 1 and orders by expected rank", () => {
    const facts = [makeFact("low"), makeFact("high")];
    const judgments = new Map([
      ["low", judgment(certain(0))],
      ["high", judgment(certain(4))],
    ]);
    const ranked = rankProbabilistically(facts, judgments, opts);
    expect(ranked.map((r) => r.workItemId)).toEqual(["high", "low"]);
    expect(ranked[0].probabilistic?.rankProbabilities).toEqual([1, 0]);
    expect(ranked[0].probabilistic?.pTop1).toBe(1);
    expect(ranked[0].probabilistic?.expectedRank).toBe(1);
    expect(ranked[1].probabilistic?.expectedRank).toBe(2);
    expect(ranked.every((r) => r.source === "probabilistic" && r.score === undefined)).toBe(true);
    expect(ranked.every((r) => r.probabilistic?.tieGroup === null)).toBe(true);
  });

  it("each item's rank probabilities sum to 1 and each rank column sums to 1", () => {
    const facts = ["a", "b", "c", "d"].map((id) => makeFact(id));
    const judgments = new Map(facts.map((f) => [f.item.id, judgment(uniform(), uniform())]));
    const ranked = rankProbabilistically(facts, judgments, { ...opts, runs: 500 });
    for (const r of ranked) {
      expect(r.probabilistic!.rankProbabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
    for (let k = 0; k < 4; k++) {
      const column = ranked.reduce((sum, r) => sum + r.probabilistic!.rankProbabilities[k], 0);
      expect(column).toBeCloseTo(1, 9);
    }
  });

  it("is deterministic for identical inputs and varies with the seed", () => {
    const facts = ["a", "b", "c"].map((id) => makeFact(id));
    const judgments = new Map(facts.map((f) => [f.item.id, judgment(uniform(), uniform())]));
    const one = rankProbabilistically(facts, judgments, { ...opts, runs: 300 });
    const two = rankProbabilistically(facts, judgments, { ...opts, runs: 300 });
    expect(two).toEqual(one);
    const other = rankProbabilistically(facts, judgments, { ...opts, runs: 300, seed: "different" });
    expect(other.map((r) => r.probabilistic!.expectedRank)).not.toEqual(one.map((r) => r.probabilistic!.expectedRank));
  });

  it("lets a deterministic fact outweigh an uncertain judgment: a red item beats a green one with equal judgments", () => {
    const facts = [makeFact("green"), makeFact("red", { severity: { level: "red", reason: "10 days overdue" } })];
    const judgments = new Map([
      ["green", judgment(certain(2))],
      ["red", judgment(certain(2))],
    ]);
    expect(rankProbabilistically(facts, judgments, opts).map((r) => r.workItemId)).toEqual(["red", "green"]);
  });

  it("ranks the higher-leverage item first more often than not when distributions overlap", () => {
    const facts = [makeFact("a"), makeFact("b")];
    const judgments = new Map([
      ["a", judgment({ probabilities: [0.05, 0.1, 0.2, 0.35, 0.3], confidence: 0.3 })],
      ["b", judgment({ probabilities: [0.3, 0.35, 0.2, 0.1, 0.05], confidence: 0.3 })],
    ]);
    const ranked = rankProbabilistically(facts, judgments, opts);
    expect(ranked[0].workItemId).toBe("a");
    expect(ranked[0].probabilistic!.pTop1).toBeGreaterThan(0.5);
    expect(ranked[0].probabilistic!.pTop1).toBeLessThan(1);
    expect(ranked[0].probabilistic!.tieGroup).toBeNull();
  });

  it("changes the order when the operator-facing facts change, without any new judgment", () => {
    const judgments = new Map([
      ["a", judgment(certain(2))],
      ["b", judgment(certain(2))],
    ]);
    const before = rankProbabilistically([makeFact("a"), makeFact("b")], judgments, opts);
    const after = rankProbabilistically(
      [makeFact("a"), makeFact("b", { releasesWorkForNames: ["x", "y"] })],
      judgments,
      opts,
    );
    expect(before[0].probabilistic!.tieGroup).not.toBeNull(); // identical inputs tie
    expect(after.map((r) => r.workItemId)).toEqual(["b", "a"]);
  });

  describe("ties", () => {
    const facts = [makeFact("x"), makeFact("y"), makeFact("z", { severity: { level: "red", reason: "late" } })];
    const judgments = new Map(facts.map((f) => [f.item.id, judgment(certain(2))]));

    it("groups identical items, shares their rank probability, and flags the need for a decision", () => {
      const ranked = rankProbabilistically(facts, judgments, opts);
      expect(ranked[0].workItemId).toBe("z");
      const [, a, b] = ranked;
      expect(a.probabilistic!.tieGroup).not.toBeNull();
      expect(a.probabilistic!.tieGroup).toBe(b.probabilistic!.tieGroup);
      expect(a.probabilistic!.needsDecision).toBe(true);
      expect(a.probabilistic!.expectedRank).toBe(2.5);
      expect(a.probabilistic!.rankProbabilities).toEqual([0, 0.5, 0.5]);
      expect(ranked[0].probabilistic!.tieGroup).toBeNull();
    });

    it("applies the operator's order inside the group and stops asking", () => {
      const ranked = rankProbabilistically(facts, judgments, { ...opts, operatorOrder: [["y", "x"]] });
      expect(ranked.map((r) => r.workItemId)).toEqual(["z", "y", "x"]);
      expect(ranked[1].probabilistic!.needsDecision).toBe(false);
      expect(ranked[2].probabilistic!.needsDecision).toBe(false);
      expect(ranked[1].probabilistic!.tieGroup).toBe(ranked[2].probabilistic!.tieGroup);
    });

    it("still asks, and keeps the default order, when the decision covers only part of the group", () => {
      const ranked = rankProbabilistically(facts, judgments, { ...opts, operatorOrder: [["y"]] });
      expect(ranked.map((r) => r.workItemId)).toEqual(["z", "x", "y"]);
      expect(ranked[1].probabilistic!.needsDecision).toBe(true);
    });

    it("does not let a choice about one set of items stand in for a different tie group", () => {
      // x and y were each ordered, but against other items (x with w, y with v), never against each other.
      const ranked = rankProbabilistically(facts, judgments, { ...opts, operatorOrder: [["x", "w"], ["y", "v"]] });
      expect(ranked.map((r) => r.workItemId)).toEqual(["z", "x", "y"]);
      expect(ranked[1].probabilistic!.needsDecision).toBe(true);
      expect(ranked[2].probabilistic!.needsDecision).toBe(true);
    });

    it("uses the decision made for exactly this group, even when it was recorded in another order", () => {
      const ranked = rankProbabilistically(facts, judgments, { ...opts, operatorOrder: [["a", "b"], ["y", "x"]] });
      expect(ranked.map((r) => r.workItemId)).toEqual(["z", "y", "x"]);
      expect(ranked[1].probabilistic!.needsDecision).toBe(false);
    });

    it("does not let the operator's order move an item outside its tie group", () => {
      const ranked = rankProbabilistically(facts, judgments, { ...opts, operatorOrder: [["x", "y", "z"], ["x", "y"]] });
      expect(ranked[0].workItemId).toBe("z");
    });

    it("does not tie items that differ with certainty", () => {
      const lonely = [makeFact("p"), makeFact("q", { severity: { level: "amber", reason: "late" } })];
      const ranked = rankProbabilistically(lonely, new Map(lonely.map((f) => [f.item.id, judgment(certain(2))])), opts);
      expect(ranked.every((r) => r.probabilistic!.tieGroup === null)).toBe(true);
    });
  });

  it("carries the lowest Jev confidence and the raw estimates onto the entry", () => {
    const facts = [makeFact("a")];
    const judgments = new Map([
      ["a", { leverage: { ...certain(3), confidence: 0.8 }, slipRisk: { ...certain(1), confidence: 0.4 } }],
    ]);
    const [entry] = rankProbabilistically(facts, judgments, opts);
    expect(entry.probabilistic!.confidence).toBe(0.4);
    expect(entry.probabilistic!.leverage.probabilities[3]).toBe(1);
    expect(entry.rank).toBe(1);
  });

  it("returns an empty list for no items and throws when a judgment is missing", () => {
    expect(rankProbabilistically([], new Map(), opts)).toEqual([]);
    expect(() => rankProbabilistically([makeFact("a")], new Map(), opts)).toThrow(/No Jev judgment/);
  });
});

describe("applyOperatorOrder", () => {
  const facts = [makeFact("x"), makeFact("y"), makeFact("z", { severity: { level: "red", reason: "late" } })];
  const judgments = new Map(facts.map((f) => [f.item.id, judgment(certain(2))]));
  const base = rankProbabilistically(facts, judgments, opts);

  it("is the identity with no operator order", () => {
    expect(applyOperatorOrder(base, [])).toBe(base);
  });

  it("is idempotent and leaves probabilities untouched", () => {
    const once = applyOperatorOrder(base, [["y", "x"]]);
    expect(applyOperatorOrder(once, [["y", "x"]])).toEqual(once);
    expect(once.find((e) => e.workItemId === "x")!.probabilistic!.rankProbabilities).toEqual(
      base.find((e) => e.workItemId === "x")!.probabilistic!.rankProbabilities,
    );
  });

  it("matches ranking with the order supplied up front", () => {
    expect(applyOperatorOrder(base, [["y", "x"]])).toEqual(rankProbabilistically(facts, judgments, { ...opts, operatorOrder: [["y", "x"]] }));
  });

  it("ignores decisions that do not match a tie group's exact members", () => {
    const out = applyOperatorOrder(base, [["z", "unknown"]]);
    expect(out.map((e) => e.workItemId)).toEqual(["z", "x", "y"]);
    expect(out[1].probabilistic!.needsDecision).toBe(true);
  });
});
