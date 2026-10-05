import { describe, expect, it } from "vitest";
import type { DependencyImpact } from "./dependencies";
import type { Person, PriorityRankingEntry, WorkItem } from "./types";
import {
  DEPARTMENT_TOP,
  NO_TEAM,
  averageCycleDays,
  buildDepartmentRows,
  buildPersonRows,
  computeScopeStats,
  countTiesToDecide,
  describeAxes,
  describeInferenceUsage,
  onTimeRate,
  openBlockersOf,
  takeTop,
  topLimit,
} from "./views";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const alice: Person = { id: "p:alice", name: "Alice", sourceRefs: [] };
const bob: Person = { id: "p:bob", name: "Bob", sourceRefs: [] };

function item(id: string, o: Partial<WorkItem> = {}): WorkItem {
  return {
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
    ...o,
  };
}

const impact = (blocked: string[] = [], released: Person[] = []): DependencyImpact => ({
  blockedItemIds: blocked,
  releasesWorkFor: released,
});

describe("onTimeRate", () => {
  it("counts delivered items closed on or before due, and ignores abandoned, open and undated ones", () => {
    const items = [
      item("a", { isDone: true, dueDateMs: NOW, closedMs: NOW - DAY }),
      item("b", { isDone: true, dueDateMs: NOW, closedMs: NOW + DAY }),
      item("c", { isDone: true, outcome: "abandoned", dueDateMs: NOW, closedMs: NOW - DAY }),
      item("d", { dueDateMs: NOW }),
      item("e", { isDone: true, closedMs: NOW }),
    ];
    expect(onTimeRate(items)).toEqual({ rate: 0.5, sample: 2 });
  });

  it("returns null, not zero, when there is no history", () => {
    expect(onTimeRate([item("a")])).toEqual({ rate: null, sample: 0 });
  });
});

describe("averageCycleDays", () => {
  it("averages created-to-closed over delivered items only", () => {
    const items = [
      item("a", { isDone: true, createdMs: NOW - 4 * DAY, closedMs: NOW }),
      item("b", { isDone: true, createdMs: NOW - 2 * DAY, closedMs: NOW }),
      item("c", { isDone: true, outcome: "abandoned", createdMs: NOW - 90 * DAY, closedMs: NOW }),
    ];
    expect(averageCycleDays(items)).toEqual({ days: 3, sample: 2 });
  });

  it("is null when nothing qualifies", () => {
    expect(averageCycleDays([item("a")])).toEqual({ days: null, sample: 0 });
  });
});

describe("computeScopeStats", () => {
  it("counts open, overdue, and distinct blocked people from confirmed edges", () => {
    const items = [
      item("blocker", { assignee: alice, dueDateMs: NOW - DAY }),
      item("w1", { assignee: bob }),
      item("w2", { assignee: bob }),
      item("done", { isDone: true, assignee: bob }),
    ];
    const map = new Map([["blocker", impact(["w1", "w2"], [bob])]]);
    const stats = computeScopeStats(items, map, NOW);
    expect(stats).toMatchObject({ open: 3, overdue: 1, peopleBlocked: 1 });
  });
});

describe("buildDepartmentRows / buildPersonRows", () => {
  const items = [
    item("a", { team: "Eng", assignee: alice, dueDateMs: NOW - DAY }),
    item("b", { team: "Eng", assignee: bob }),
    item("c", { assignee: bob }),
    item("d", { team: "Eng", assignee: alice, isDone: true, dueDateMs: NOW, closedMs: NOW - DAY }),
  ];

  it("groups open work by team, with a named bucket for missing teams", () => {
    expect(buildDepartmentRows(items, NOW)).toEqual([
      { team: "Eng", open: 2, overdue: 1 },
      { team: NO_TEAM, open: 1, overdue: 0 },
    ]);
  });

  it("lists only people active in the given item set, with rates and teams", () => {
    const rows = buildPersonRows([alice, bob], items, new Map(), NOW);
    expect(rows.map((r) => r.person.id)).toEqual(["p:bob", "p:alice"]);
    expect(rows[1]).toMatchObject({ open: 1, overdue: 1, onTime: { rate: 1, sample: 1 }, teams: ["Eng"] });

    const scoped = buildPersonRows([alice, bob], items.filter((i) => i.id === "b"), new Map(), NOW);
    expect(scoped.map((r) => r.person.id)).toEqual(["p:bob"]);
  });
});

describe("describeAxes", () => {
  it("reports time and scope, and leaves resource null without tracked and estimated time", () => {
    const axes = describeAxes(item("a", { dueDateMs: NOW - 6 * DAY }), impact(["x"], [alice, bob]), 1, NOW);
    expect(axes.time).toBe("6 days overdue");
    expect(axes.scope).toBe("releases work for 2 people, 1 more AI-inferred");
    expect(axes.resource).toBeNull();
  });

  it("names an abandoned blocker in the scope text", () => {
    expect(describeAxes(item("a"), undefined, 0, NOW, 1).scope).toBe(
      "blocks no one (confirmed), needs re-planning: waiting on 1 abandoned item",
    );
  });

  it("handles future, missing and finished due dates", () => {
    expect(describeAxes(item("a", { dueDateMs: NOW + 3 * DAY }), undefined, 0, NOW).time).toBe("Due in 3 days");
    expect(describeAxes(item("a"), undefined, 0, NOW).time).toBe("No due date set");
    expect(describeAxes(item("a", { isDone: true }), undefined, 0, NOW).time).toBe("Finished");
    expect(describeAxes(item("a"), undefined, 0, NOW).scope).toBe("blocks no one (confirmed)");
  });

  it("shows resource only when both tracked and estimated time exist", () => {
    const both = item("a", { timeTrackedMs: 3_600_000 * 2, estimatedDurationMs: 3_600_000 * 5 });
    expect(describeAxes(both, undefined, 0, NOW).resource).toBe("2 h tracked of 5 h estimated");
    expect(describeAxes(item("a", { timeTrackedMs: 1 }), undefined, 0, NOW).resource).toBeNull();
  });
});

describe("openBlockersOf", () => {
  it("finds the open items a given item is waiting on", () => {
    const a = item("a");
    const b = item("b");
    const map = new Map([["a", impact(["b"])], ["b", impact()]]);
    expect(openBlockersOf("b", map, new Map([["a", a], ["b", b]]))).toEqual([a]);
    expect(openBlockersOf("a", map, new Map([["a", a], ["b", b]]))).toEqual([]);
  });
});

describe("topLimit", () => {
  it("is always 5 in a department, whatever the page asks for", () => {
    expect(DEPARTMENT_TOP).toBe(5);
    expect(topLimit("Marketing", undefined)).toBe(5);
    expect(topLimit("Marketing", "10")).toBe(5);
  });

  it("is 5 company-wide by default and 10 only when asked", () => {
    expect(topLimit(null, undefined)).toBe(5);
    expect(topLimit(null, "5")).toBe(5);
    expect(topLimit(null, "10")).toBe(10);
    expect(topLimit(null, ["10", "5"])).toBe(10);
  });

  it("falls back to 5 for anything else", () => {
    for (const bad of ["7", "100", "0", "-10", "abc", "", "10.5", [], null]) expect(topLimit(null, bad)).toBe(5);
  });
});

describe("countTiesToDecide", () => {
  const entry = (id: string, tieGroup: string | null, needsDecision: boolean): PriorityRankingEntry => ({
    workItemId: id,
    rank: 1,
    reasoning: "",
    releasesWorkFor: [],
    source: "probabilistic",
    probabilistic: {
      expectedRank: 1, rankProbabilities: [1], pTop1: 1, pTop3: 1, confidence: 1,
      leverage: { probabilities: [1], confidence: 1 }, slipRisk: { probabilities: [1], confidence: 1 },
      tieGroup, needsDecision,
    },
  });

  it("counts each undecided tie group once, however many of its members are listed", () => {
    expect(countTiesToDecide([entry("a", "tie-1", true), entry("b", "tie-1", true), entry("c", "tie-2", true), entry("d", null, false)])).toBe(2);
  });

  it("does not count a group the operator has already ordered, or entries without ranking detail", () => {
    const plain: PriorityRankingEntry = { workItemId: "x", rank: 2, reasoning: "", releasesWorkFor: [], source: "rule-based" };
    expect(countTiesToDecide([entry("a", "tie-1", false), plain])).toBe(0);
    expect(countTiesToDecide([])).toBe(0);
  });

  it("counts only the entries it is given, so a tie among hidden items is not counted", () => {
    const all = [entry("a", null, false), entry("b", "tie-1", true), entry("c", "tie-1", true)];
    expect(countTiesToDecide(all.slice(0, 1))).toBe(0);
    expect(countTiesToDecide(all)).toBe(1);
  });
});

describe("takeTop", () => {
  it("keeps the first items in order and reports the full count", () => {
    expect(takeTop([1, 2, 3, 4, 5, 6, 7], 5)).toEqual({ shown: [1, 2, 3, 4, 5], total: 7 });
  });

  it("returns everything when the list is shorter than the limit, and nothing for an empty list", () => {
    expect(takeTop([1, 2], 5)).toEqual({ shown: [1, 2], total: 2 });
    expect(takeTop([], 5)).toEqual({ shown: [], total: 0 });
  });

  it("does not change the list it is given", () => {
    const list = [3, 2, 1];
    takeTop(list, 1);
    expect(list).toEqual([3, 2, 1]);
  });
});

describe("describeInferenceUsage", () => {
  const meter = { calls: 3, incrementalCalls: 2, reusedRebuilds: 9, failures: 0, inputTokens: 21400, outputTokens: 1900, lastItemCount: 6, lastFailure: null };

  it("states requests, reused rebuilds, failures and tokens, and has no failure line when nothing failed", () => {
    const { usage, failure } = describeInferenceUsage(meter);
    expect(usage).toContain("3 requests (2 on new or changed items only)");
    expect(usage).toContain("9 rebuilds reused without a request");
    expect(usage).toContain("0 failed, 21,400 input and 1,900 output tokens");
    expect(failure).toBeNull();
  });

  it("uses the singular for one, and names the last cause when a call failed", () => {
    const { usage, failure } = describeInferenceUsage({ ...meter, calls: 1, reusedRebuilds: 1, failures: 1, lastFailure: "ApiError, HTTP 529, request req_1" });
    expect(usage).toContain("1 request (");
    expect(usage).toContain("1 rebuild reused");
    expect(failure).toBe("The dependency check failed 1 time and kept the links it already had. Last cause: ApiError, HTTP 529, request req_1.");
  });
});
