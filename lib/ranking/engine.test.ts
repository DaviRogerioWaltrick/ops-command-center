import { describe, expect, it } from "vitest";
import { assembleRanking, buildPrompt, rankWithRules, rankWorkItems, type RankingGenerator } from "./engine";
import type { WorkItemFact } from "./facts";
import type { WorkItem } from "../types";

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

describe("rankWithRules", () => {
  it("ranks red severity above green", () => {
    const facts = [makeFact("green-item"), makeFact("red-item", { severity: { level: "red", reason: "10 days overdue" } })];
    const ranked = rankWithRules(facts);
    expect(ranked[0].workItemId).toBe("red-item");
  });

  it("ranks an item that releases work for others above an equally-overdue item that releases none", () => {
    const facts = [
      makeFact("blocks-nobody", { severity: { level: "amber", reason: "2 days overdue" } }),
      makeFact("blocks-two", { severity: { level: "amber", reason: "2 days overdue" }, releasesWorkForNames: ["Alice", "Bob"] }),
    ];
    const ranked = rankWithRules(facts);
    expect(ranked[0].workItemId).toBe("blocks-two");
  });

  it("assigns sequential ranks starting at 1 and marks the source as rule-based", () => {
    const ranked = rankWithRules([makeFact("a"), makeFact("b")]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
    expect(ranked.every((r) => r.source === "rule-based")).toBe(true);
  });
});

describe("rankWithRules: abandoned blockers and due dates", () => {
  const abandoned = [{ title: "Dropped work", note: "No longer needed." }];
  const score = (fact: WorkItemFact) => rankWithRules([fact])[0].score ?? Number.NaN;

  it("scores a re-plan item 40 above baseline, and 60 when due within 7 days or overdue", () => {
    const baseline = score(makeFact("a"));
    expect(score(makeFact("b", { abandonedBlockers: abandoned, daysUntilDue: 20 }))).toBe(baseline + 40);
    expect(score(makeFact("c", { abandonedBlockers: abandoned, daysUntilDue: 7 }))).toBe(baseline + 60);
    expect(score(makeFact("d", { abandonedBlockers: abandoned, daysUntilDue: 3 }))).toBe(baseline + 60);
    expect(score(makeFact("e", { abandonedBlockers: abandoned, daysUntilDue: -2 }))).toBe(baseline + 60);
    expect(score(makeFact("f", { abandonedBlockers: abandoned, daysUntilDue: 8 }))).toBe(baseline + 40);
    expect(score(makeFact("g", { abandonedBlockers: abandoned, daysUntilDue: null }))).toBe(baseline + 40);
  });

  it("ranks a due-soon re-plan item above an amber item that blocks no one, and below red plus releases", () => {
    const facts = [
      makeFact("amber", { severity: { level: "amber", reason: "2 days overdue" } }),
      makeFact("replan", { abandonedBlockers: abandoned, daysUntilDue: 3 }),
      makeFact("red-releases", { severity: { level: "red", reason: "8 days overdue" }, releasesWorkForNames: ["Alice"] }),
    ];
    expect(rankWithRules(facts).map((r) => r.workItemId)).toEqual(["red-releases", "replan", "amber"]);
  });

  it("an item with no abandoned blocker gets no bonus from being due soon", () => {
    expect(score(makeFact("a", { daysUntilDue: 2 }))).toBe(score(makeFact("b", { daysUntilDue: 30 })));
  });

  it("breaks equal scores by soonest due date, with no due date last", () => {
    const facts = [
      makeFact("none", { daysUntilDue: null }),
      makeFact("far", { daysUntilDue: 12 }),
      makeFact("near", { daysUntilDue: 3 }),
    ];
    expect(rankWithRules(facts).map((r) => r.workItemId)).toEqual(["near", "far", "none"]);
  });

  it("names the re-plan and the due date in the fallback reasoning", () => {
    const [entry] = rankWithRules([makeFact("a", { abandonedBlockers: abandoned, daysUntilDue: 3 })]);
    expect(entry.reasoning).toContain("needs re-planning");
    expect(entry.reasoning).toContain("Dropped work");
    expect(entry.reasoning).toContain("due in 3 days");
  });
});

describe("assembleRanking", () => {
  const facts = [makeFact("a"), makeFact("b"), makeFact("c")];
  const raw = (ids: string[]) => ids.map((id) => ({ workItemId: id, reasoning: `why ${id}` }));

  it("returns a ranking in the model's order when every item appears exactly once", () => {
    const ranked = assembleRanking(facts, raw(["c", "a", "b"]));
    expect(ranked?.map((r) => [r.workItemId, r.rank, r.source])).toEqual([["c", 1, "ai"], ["a", 2, "ai"], ["b", 3, "ai"]]);
    expect(ranked?.[0].reasoning).toBe("why c");
  });

  it("rejects a list that drops an item", () => {
    expect(assembleRanking(facts, raw(["a", "b"]))).toBeNull();
  });

  it("rejects an unknown id, such as one with its source prefix stripped", () => {
    expect(assembleRanking(facts, raw(["a", "b", "x"]))).toBeNull();
  });

  it("rejects a repeated id even when the count matches", () => {
    expect(assembleRanking(facts, raw(["a", "a", "b"]))).toBeNull();
  });
});

describe("rankWorkItems retry and fallback", () => {
  const facts = [makeFact("a"), makeFact("b"), makeFact("c", { severity: { level: "red", reason: "9 days overdue" } })];
  const complete = [{ workItemId: "b", reasoning: "x" }, { workItemId: "a", reasoning: "y" }, { workItemId: "c", reasoning: "z" }];
  const incomplete = complete.slice(0, 2);

  function scripted(results: (typeof complete | Error)[]): { generate: RankingGenerator; calls: () => number } {
    let calls = 0;
    return {
      generate: async () => {
        const next = results[calls++];
        if (next instanceof Error) throw next;
        return next;
      },
      calls: () => calls,
    };
  }

  it("uses the first attempt when it is complete, without retrying", async () => {
    const { generate, calls } = scripted([complete]);
    const ranked = await rankWorkItems(facts, generate);
    expect(ranked.map((r) => r.workItemId)).toEqual(["b", "a", "c"]);
    expect(ranked.every((r) => r.source === "ai")).toBe(true);
    expect(calls()).toBe(1);
  });

  it("retries once after an incomplete list and uses the second answer", async () => {
    const { generate, calls } = scripted([incomplete, complete]);
    const ranked = await rankWorkItems(facts, generate);
    expect(ranked[0].source).toBe("ai");
    expect(calls()).toBe(2);
  });

  it("retries once after an error too", async () => {
    const { generate, calls } = scripted([new Error("overloaded"), complete]);
    expect((await rankWorkItems(facts, generate))[0].source).toBe("ai");
    expect(calls()).toBe(2);
  });

  it("falls back to the rule-based order after two failed attempts, and never tries a third", async () => {
    const { generate, calls } = scripted([incomplete, new Error("boom"), complete]);
    const ranked = await rankWorkItems(facts, generate);
    expect(ranked.every((r) => r.source === "rule-based")).toBe(true);
    expect(ranked[0].workItemId).toBe("c");
    expect(calls()).toBe(2);
  });

  it("returns an empty ranking without calling the model when nothing is open", async () => {
    const { generate, calls } = scripted([complete]);
    expect(await rankWorkItems([], generate)).toEqual([]);
    expect(calls()).toBe(0);
  });
});

describe("buildPrompt", () => {
  it("states the exact item count and asks for ids copied with their prefix", () => {
    const prompt = buildPrompt([makeFact("a"), makeFact("b")]);
    expect(prompt).toContain("exactly 2 items");
    expect(prompt).toContain("exactly 2 entries");
    expect(prompt).toContain("including its prefix");
  });
});

