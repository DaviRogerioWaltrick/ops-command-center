import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearJevCache, rankWorkItemsProbabilistic, resetJevMeter, getJevMeter, type AskJev } from "./jev";
import { createDemoAsk, DEMO_LABEL, DEMO_NAMESPACE } from "./jev-demo";
import { validateEstimate } from "./probabilistic";
import type { WorkItemFact } from "./facts";
import type { WorkItem } from "../types";

function makeFact(id: string, overrides: Partial<WorkItemFact> = {}, item: Partial<WorkItem> = {}): WorkItemFact {
  return {
    item: {
      id, source: "test", externalId: id, title: `Title ${id}`, status: "open", isDone: false, assignee: null,
      url: "https://example.com", dueDateMs: null, createdMs: null, closedMs: null, updatedMs: null, ...item,
    },
    severity: { level: "green", reason: "On track" },
    releasesWorkForNames: [], inferredBlockingNotes: [], ownerOpenCount: null, ownerOverdueCount: null,
    daysUntilDue: null, abandonedBlockers: [], abandonedTrackedMs: null, ...overrides,
  };
}

beforeEach(() => {
  clearJevCache();
  resetJevMeter();
});

describe("demo ask", () => {
  it("is deterministic, valid, free, and responds to the state", async () => {
    const ask = createDemoAsk();
    const quiet = { title: "a" };
    const loud = { title: "a", people_released: ["x", "y", "z"], latest_note: "Blocked, waiting on legal" };
    const one = await ask(quiet);
    expect(await ask(quiet)).toEqual(one);
    expect(one.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    for (const dim of [one.judgment.leverage, one.judgment.slipRisk]) validateEstimate(dim, "demo");
    const high = await ask(loud);
    const mean = (p: number[]) => p.reduce((s, x, i) => s + x * i, 0);
    expect(mean(high.judgment.leverage.probabilities)).toBeGreaterThan(mean(one.judgment.leverage.probabilities));
    expect(mean(high.judgment.slipRisk.probabilities)).toBeGreaterThan(mean(one.judgment.slipRisk.probabilities));
  });
});

describe("cache namespaces", () => {
  it("never reuses a demo judgment for a live ask", async () => {
    const facts = [makeFact("a")];
    const ask: AskJev = vi.fn(createDemoAsk());
    await rankWorkItemsProbabilistic(facts, { ask, namespace: DEMO_NAMESPACE, runs: 20 });
    await rankWorkItemsProbabilistic(facts, { ask, namespace: DEMO_NAMESPACE, runs: 20 });
    expect(ask).toHaveBeenCalledTimes(1);
    await rankWorkItemsProbabilistic(facts, { ask, runs: 20 });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(getJevMeter().cacheHits).toBe(1);
  });

  it("labels the reasoning as a demo estimate when asked", async () => {
    const [entry] = (await rankWorkItemsProbabilistic([makeFact("a")], { ask: createDemoAsk(), namespace: DEMO_NAMESPACE, estimateLabel: DEMO_LABEL, runs: 20 }))!;
    expect(entry.reasoning).toContain(DEMO_LABEL);
    expect(entry.reasoning).not.toContain("model estimate");
  });
});
