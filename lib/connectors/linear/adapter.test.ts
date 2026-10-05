import { describe, expect, it } from "vitest";
import { getAggregatedData } from "../registry";
import { toDependencyEdges, toWorkItem } from "./adapter";
import type { RawLinearIssue } from "./fixtures";
import { buildDependencyImpact, findItemsBlockedByAbandonedWork } from "../../dependencies";
import { computeWorkloadSnapshots } from "../../workload";

/**
 * The third connector exists to stress the canonical model. These tests cover
 * what it exposed: inverse-direction edges, cross-source person merging (a
 * real registry bug, fixed), and Linear's Canceled state, which `outcome`
 * now separates from Completed.
 */
describe("linear connector", () => {
  it("flips Linear's inverse blocking relations into the canonical blocker -> blocked direction", async () => {
    const { dependencyEdges } = await getAggregatedData();
    expect(dependencyEdges).toContainEqual({
      blockerId: "linear:lin-301",
      blockedId: "linear:lin-302",
      confidence: "confirmed",
    });
    expect(dependencyEdges).not.toContainEqual(expect.objectContaining({ blockerId: "linear:lin-302", blockedId: "linear:lin-301" }));
  });

  it("merges people who also exist in ClickUp by email, and keeps a new person separate", async () => {
    const { people } = await getAggregatedData();
    const priya = people.filter((p) => p.email === "priya@example.com");
    expect(priya).toHaveLength(1);
    expect(priya[0].sourceRefs.map((r) => r.source).sort()).toEqual(["clickup", "linear"]);
    expect(people.filter((p) => p.email === "theo@example.com")).toHaveLength(1);
  });

  it("counts a merged person's items from every source in workload, not just the first source's", async () => {
    const { people, workItems, dependencyEdges } = await getAggregatedData();
    const impact = buildDependencyImpact(workItems, dependencyEdges);
    const snaps = computeWorkloadSnapshots(people, workItems, impact);
    for (const email of ["priya@example.com", "sana@example.com"]) {
      const person = people.find((p) => p.email === email)!;
      const openAcrossSources = workItems.filter((i) => i.assignee?.email === email && !i.isDone).length;
      expect(openAcrossSources).toBeGreaterThan(0);
      expect(snaps.find((s) => s.personId === person.id)!.openCount).toBe(openAcrossSources);
    }
  });

  it("reads Linear's confirmed edges through the unchanged impact logic", async () => {
    const { people, workItems, dependencyEdges } = await getAggregatedData();
    const impact = buildDependencyImpact(workItems, dependencyEdges);
    expect(impact.get("linear:lin-301")?.releasesWorkFor.map((p) => p.email)).toEqual(["priya@example.com"]);
    expect(impact.get("linear:lin-304")?.releasesWorkFor.map((p) => p.email)).toEqual(["sana@example.com"]);
    expect(people.length).toBeGreaterThan(0);
  });

  it("maps completed to delivered and canceled to abandoned, both still isDone", async () => {
    const { workItems } = await getAggregatedData();
    const byId = (id: string) => workItems.find((i) => i.id === id)!;
    expect(byId("linear:lin-306")).toMatchObject({ isDone: true, outcome: "delivered" });
    expect(byId("linear:lin-305")).toMatchObject({ isDone: true, outcome: "abandoned" });
    expect(byId("linear:lin-301")).toMatchObject({ isDone: false, outcome: null });
  });

  it("does not count an abandoned issue as a delivery in closedLast7d", async () => {
    const { people, workItems, dependencyEdges } = await getAggregatedData();
    const impact = buildDependencyImpact(workItems, dependencyEdges);
    const sana = people.find((p) => p.email === "sana@example.com")!;
    const withAbandoned = computeWorkloadSnapshots(people, workItems, impact).find((s) => s.personId === sana.id)!;
    const without = computeWorkloadSnapshots(
      people,
      workItems.filter((i) => i.id !== "linear:lin-305"),
      impact,
    ).find((s) => s.personId === sana.id)!;
    expect(withAbandoned.closedLast7d).toBe(without.closedLast7d);
  });

  it("flags an item blocked by an abandoned issue for re-planning", async () => {
    const { workItems, dependencyEdges } = await getAggregatedData();
    const flagged = findItemsBlockedByAbandonedWork(workItems, dependencyEdges);
    expect(flagged.map((f) => f.item.id)).toEqual(["linear:lin-307"]);
    expect(flagged[0].abandonedBlockers.map((i) => i.id)).toEqual(["linear:lin-305"]);
  });
});

/** A minimal issue in Linear's real shape, for mapping cases the fixture does not cover. */
const issue = (overrides: Partial<RawLinearIssue> = {}): RawLinearIssue => ({
  id: "x-1",
  title: "T",
  state: { name: "Todo", type: "unstarted" },
  assignee: null,
  url: "https://linear.app/example/issue/X-1",
  dueDate: null,
  createdAt: null,
  completedAt: null,
  canceledAt: null,
  updatedAt: null,
  ...overrides,
});

describe("linear state mapping", () => {
  it("treats triage, backlog, unstarted and started as open with no outcome", () => {
    for (const type of ["triage", "backlog", "unstarted", "started"] as const) {
      expect(toWorkItem(issue({ state: { name: "S", type } }))).toMatchObject({ isDone: false, outcome: null, closedMs: null });
    }
  });

  it("maps duplicate to abandoned, like canceled, and does not invent a close date", () => {
    const duplicate = toWorkItem(issue({ state: { name: "Duplicate", type: "duplicate" } }));
    expect(duplicate).toMatchObject({ isDone: true, outcome: "abandoned", closedMs: null });
    const canceled = toWorkItem(issue({ state: { name: "Canceled", type: "canceled" }, canceledAt: "2026-10-01T00:00:00.000Z" }));
    expect(canceled).toMatchObject({ isDone: true, outcome: "abandoned", closedMs: Date.parse("2026-10-01T00:00:00.000Z") });
  });

  it("treats a state type it does not know as open rather than guessing", () => {
    expect(toWorkItem(issue({ state: { name: "New", type: "brand-new" as never } }))).toMatchObject({ isDone: false, outcome: null });
  });

  it("takes the newest comment by timestamp, whatever order the API returns", () => {
    const item = toWorkItem(
      issue({
        comments: {
          nodes: [
            { body: "newest", createdAt: "2026-10-03T00:00:00.000Z" },
            { body: "oldest", createdAt: "2026-10-01T00:00:00.000Z" },
          ],
        },
      }),
    );
    expect(item.lastActivityNote).toBe("newest");
    expect(toWorkItem(issue()).lastActivityNote).toBeNull();
  });

  it("reads project and team from their nested objects, and allows both to be absent", () => {
    expect(toWorkItem(issue({ project: { id: "p1", name: "Proj" }, team: { name: "Eng" } }))).toMatchObject({
      parent: { id: "linear:p1", title: "Proj" },
      team: "Eng",
    });
    expect(toWorkItem(issue())).toMatchObject({ parent: null, team: null });
  });
});

describe("linear dependency edges", () => {
  it("builds an edge only from 'blocks' relations, pointing blocker to blocked", () => {
    const edges = toDependencyEdges([
      issue({
        id: "b",
        inverseRelations: {
          nodes: [
            { type: "blocks", issue: { id: "a" } },
            { type: "related", issue: { id: "r" } },
            { type: "duplicate", issue: { id: "d" } },
          ],
        },
      }),
    ]);
    expect(edges).toEqual([{ blockerId: "linear:a", blockedId: "linear:b", confidence: "confirmed" }]);
  });

  it("returns no edges for issues without relations", () => {
    expect(toDependencyEdges([issue()])).toEqual([]);
  });
});
