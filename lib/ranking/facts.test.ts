import { describe, expect, it } from "vitest";
import { buildWorkItemFacts } from "./facts";
import type { WorkItem } from "../types";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

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

describe("buildWorkItemFacts", () => {
  it("computes whole days until due for every open item, negative when overdue, null with no date", () => {
    const items = [
      item("soon", { dueDateMs: NOW + 3 * DAY }),
      item("late", { dueDateMs: NOW - 2 * DAY }),
      item("none"),
      item("done", { isDone: true, dueDateMs: NOW }),
    ];
    const facts = buildWorkItemFacts(items, new Map(), [], new Map(), new Map(), NOW);
    expect(facts.map((f) => [f.item.id, f.daysUntilDue])).toEqual([["soon", 3], ["late", -2], ["none", null]]);
  });

  it("carries abandoned blockers with their note, and sums tracked time only when every blocker has it", () => {
    const a = item("a", { isDone: true, outcome: "abandoned", lastActivityNote: "Dropped.", timeTrackedMs: 3_600_000 });
    const b = item("b", { isDone: true, outcome: "abandoned", timeTrackedMs: 7_200_000 });
    const c = item("c", { isDone: true, outcome: "abandoned" });
    const target = item("t");
    const [fact] = buildWorkItemFacts([target], new Map(), [], new Map(), new Map([["t", [a, b]]]), NOW);
    expect(fact.abandonedBlockers).toEqual([{ title: "a", note: "Dropped." }, { title: "b", note: null }]);
    expect(fact.abandonedTrackedMs).toBe(10_800_000);

    const [partial] = buildWorkItemFacts([target], new Map(), [], new Map(), new Map([["t", [a, c]]]), NOW);
    expect(partial.abandonedTrackedMs).toBeNull();
  });
});
