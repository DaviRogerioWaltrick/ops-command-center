import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText }));

import {
  buildDependencyImpact,
  clearInferenceMemory,
  findItemsBlockedByAbandonedWork,
  getInferenceMeter,
  inferDependencyEdges,
  inferredLinksFor,
  mergeDependencyEdges,
  resetInferenceMeter,
} from "./dependencies";
import type { DependencyEdge, WorkItem } from "./types";

function makeItem(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
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
    ...overrides,
  };
}

describe("buildDependencyImpact", () => {
  it("finds who is released when a blocker item is open", () => {
    const alice = { id: "p:alice", name: "Alice", sourceRefs: [] };
    const items: WorkItem[] = [
      makeItem("a", { assignee: null }),
      makeItem("b", { assignee: alice }),
    ];
    const edges: DependencyEdge[] = [{ blockerId: "a", blockedId: "b", confidence: "confirmed" }];

    const impact = buildDependencyImpact(items, edges);
    expect(impact.get("a")?.blockedItemIds).toEqual(["b"]);
    expect(impact.get("a")?.releasesWorkFor.map((p) => p.id)).toEqual(["p:alice"]);
  });

  it("ignores an edge once the blocker is already done", () => {
    const items: WorkItem[] = [makeItem("a", { isDone: true }), makeItem("b")];
    const edges: DependencyEdge[] = [{ blockerId: "a", blockedId: "b", confidence: "confirmed" }];

    const impact = buildDependencyImpact(items, edges);
    expect(impact.get("a")?.blockedItemIds).toEqual([]);
  });

  it("never counts an inferred (unconfirmed) edge toward releasesWorkFor", () => {
    const alice = { id: "p:alice", name: "Alice", sourceRefs: [] };
    const items: WorkItem[] = [makeItem("a"), makeItem("b", { assignee: alice })];
    const edges: DependencyEdge[] = [{ blockerId: "a", blockedId: "b", confidence: "inferred", note: "guessed from text" }];

    const impact = buildDependencyImpact(items, edges);
    expect(impact.get("a")?.releasesWorkFor).toEqual([]);
  });

  it("dedupes a person who is blocked by the same item more than once", () => {
    const alice = { id: "p:alice", name: "Alice", sourceRefs: [] };
    const items: WorkItem[] = [makeItem("a"), makeItem("b", { assignee: alice }), makeItem("c", { assignee: alice })];
    const edges: DependencyEdge[] = [
      { blockerId: "a", blockedId: "b", confidence: "confirmed" },
      { blockerId: "a", blockedId: "c", confidence: "confirmed" },
    ];

    const impact = buildDependencyImpact(items, edges);
    expect(impact.get("a")?.releasesWorkFor).toHaveLength(1);
  });

  it("treats a cross-source edge no differently from a same-source one — ids are already source-namespaced", () => {
    // See COMPETITIVE_ANALYSIS.md: a confirmed edge can never actually cross
    // sources in practice (no connector's API knows about another source's
    // records), but the function itself must not special-case source at
    // all — the id format already carries that information, and this graph
    // read only cares about ids matching.
    const marcus = { id: "clickup:cu-p-3", name: "Marcus Lee", sourceRefs: [] };
    const items: WorkItem[] = [
      makeItem("salesforce:sf-201", { source: "salesforce" }),
      makeItem("clickup:cu-107", { source: "clickup", assignee: marcus }),
    ];
    const edges: DependencyEdge[] = [
      { blockerId: "salesforce:sf-201", blockedId: "clickup:cu-107", confidence: "confirmed" },
    ];

    const impact = buildDependencyImpact(items, edges);
    expect(impact.get("salesforce:sf-201")?.releasesWorkFor.map((p) => p.id)).toEqual(["clickup:cu-p-3"]);
  });
});

describe("mergeDependencyEdges", () => {
  it("promotes an override to confirmed and drops it from the inferred list", () => {
    const inferred: DependencyEdge[] = [
      { blockerId: "salesforce:sf-201", blockedId: "clickup:cu-107", confidence: "inferred", note: "mentions the same MSA" },
    ];
    const overrides: DependencyEdge[] = [
      { blockerId: "salesforce:sf-201", blockedId: "clickup:cu-107", confidence: "confirmed", note: "mentions the same MSA" },
    ];

    const result = mergeDependencyEdges([], inferred, overrides);

    expect(result.confirmedEdges).toEqual(overrides);
    expect(result.inferredEdges).toEqual([]);
  });

  it("leaves an un-promoted inferred edge alone, and keeps connector-confirmed edges untouched", () => {
    const confirmedFromConnectors: DependencyEdge[] = [{ blockerId: "a", blockedId: "b", confidence: "confirmed" }];
    const inferred: DependencyEdge[] = [{ blockerId: "c", blockedId: "d", confidence: "inferred", note: "guess" }];

    const result = mergeDependencyEdges(confirmedFromConnectors, inferred, []);

    expect(result.confirmedEdges).toEqual(confirmedFromConnectors);
    expect(result.inferredEdges).toEqual(inferred);
  });

  it("only removes the specific promoted pair, not every inferred edge for that blocker", () => {
    const inferred: DependencyEdge[] = [
      { blockerId: "a", blockedId: "b", confidence: "inferred", note: "one" },
      { blockerId: "a", blockedId: "c", confidence: "inferred", note: "two" },
    ];
    const overrides: DependencyEdge[] = [{ blockerId: "a", blockedId: "b", confidence: "confirmed", note: "one" }];

    const result = mergeDependencyEdges([], inferred, overrides);

    expect(result.inferredEdges).toEqual([{ blockerId: "a", blockedId: "c", confidence: "inferred", note: "two" }]);
  });
});

describe("inferredLinksFor", () => {
  it("resolves a blocker's inferred edges to their blocked item's title", () => {
    const workItemsById = new Map<string, WorkItem>([
      ["clickup:cu-107", makeItem("clickup:cu-107", { title: "Provision Northwind's production environment" })],
    ]);
    const edges: DependencyEdge[] = [
      { blockerId: "salesforce:sf-201", blockedId: "clickup:cu-107", confidence: "inferred", note: "same MSA mentioned" },
    ];

    const links = inferredLinksFor("salesforce:sf-201", edges, workItemsById);

    expect(links).toEqual([
      {
        blockerId: "salesforce:sf-201",
        blockedId: "clickup:cu-107",
        blockedTitle: "Provision Northwind's production environment",
        note: "same MSA mentioned",
      },
    ]);
  });

  it("silently drops a link whose blocked item isn't in the current item set", () => {
    const edges: DependencyEdge[] = [{ blockerId: "a", blockedId: "missing", confidence: "inferred", note: "x" }];
    expect(inferredLinksFor("a", edges, new Map())).toEqual([]);
  });
});

describe("findItemsBlockedByAbandonedWork", () => {
  const edge = (blockerId: string, blockedId: string, confidence: DependencyEdge["confidence"] = "confirmed"): DependencyEdge => ({
    blockerId,
    blockedId,
    confidence,
  });

  it("flags an open item whose confirmed blocker was abandoned", () => {
    const items = [makeItem("a", { isDone: true, outcome: "abandoned" }), makeItem("b")];
    const result = findItemsBlockedByAbandonedWork(items, [edge("a", "b")]);
    expect(result.map((r) => r.item.id)).toEqual(["b"]);
    expect(result[0].abandonedBlockers.map((i) => i.id)).toEqual(["a"]);
  });

  it("does not flag a delivered blocker, an unknown outcome, or an open blocker", () => {
    const items = [
      makeItem("delivered", { isDone: true, outcome: "delivered" }),
      makeItem("unknown", { isDone: true }),
      makeItem("open"),
      makeItem("b"),
    ];
    const edges = [edge("delivered", "b"), edge("unknown", "b"), edge("open", "b")];
    expect(findItemsBlockedByAbandonedWork(items, edges)).toEqual([]);
  });

  it("ignores inferred edges and already-finished blocked items", () => {
    const items = [makeItem("a", { isDone: true, outcome: "abandoned" }), makeItem("b"), makeItem("c", { isDone: true })];
    expect(findItemsBlockedByAbandonedWork(items, [edge("a", "b", "inferred"), edge("a", "c")])).toEqual([]);
  });
});

const answer = (edges: { blockerId: string; blockedId: string; evidenceId: string; note?: string }[], inputTokens = 1000) => ({
  output: { edges: edges.map((e) => ({ note: "because", ...e })) },
  usage: { inputTokens, outputTokens: 50 },
});
const lastPrompt = (): string => generateText.mock.calls.at(-1)![0].prompt;

describe("inferDependencyEdges", () => {
  beforeEach(() => {
    generateText.mockReset();
    resetInferenceMeter();
    clearInferenceMemory();
    delete process.env.INFERENCE_FULL_REFRESH_MS;
  });

  it("counts the call, the items sent and the tokens, drops edges with unknown ids, and returns links without the evidence field", async () => {
    generateText.mockResolvedValue(
      answer([
        { blockerId: "a", blockedId: "b", evidenceId: "b", note: "b waits on a" },
        { blockerId: "a", blockedId: "ghost", evidenceId: "a" },
        { blockerId: "a", blockedId: "a", evidenceId: "a" },
      ], 1200),
    );

    const edges = await inferDependencyEdges([makeItem("a"), makeItem("b"), makeItem("c", { isDone: true })]);

    expect(edges).toEqual([{ blockerId: "a", blockedId: "b", confidence: "inferred", note: "b waits on a" }]);
    expect(getInferenceMeter()).toEqual({
      calls: 1, incrementalCalls: 0, reusedRebuilds: 0, failures: 0, inputTokens: 1200, outputTokens: 50, lastItemCount: 2, lastFailure: null,
    });
  });

  it("counts a failure, describes it without the message, and returns no links when nothing is remembered", async () => {
    class ApiError extends Error {
      status = 529;
      requestId = "req_1";
    }
    generateText.mockRejectedValue(new ApiError("echoes the prompt: secret title"));

    expect(await inferDependencyEdges([makeItem("a"), makeItem("b")])).toEqual([]);

    const meter = getInferenceMeter();
    expect(meter).toMatchObject({ calls: 1, failures: 1, inputTokens: 0, outputTokens: 0 });
    expect(meter.lastFailure).toBe("ApiError, HTTP 529, request req_1");
    expect(meter.lastFailure).not.toContain("secret");
  });

  it("does not call the model with fewer than two open items", async () => {
    expect(await inferDependencyEdges([makeItem("a"), makeItem("b", { isDone: true })])).toEqual([]);
    expect(generateText).not.toHaveBeenCalled();
    expect(getInferenceMeter().calls).toBe(0);
  });

  it("makes no request when nothing changed since the last run, and returns the same links", async () => {
    generateText.mockResolvedValue(answer([{ blockerId: "a", blockedId: "b", evidenceId: "b" }]));
    const items = [makeItem("a"), makeItem("b"), makeItem("c")];

    const first = await inferDependencyEdges(items);
    const second = await inferDependencyEdges(items);

    expect(second).toEqual(first);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(getInferenceMeter()).toMatchObject({ calls: 1, reusedRebuilds: 1 });
  });

  it("re-asks only about a changed or new item, shows the others by title only, and keeps links justified by unchanged text", async () => {
    generateText.mockResolvedValueOnce(
      answer([
        { blockerId: "a", blockedId: "b", evidenceId: "b", note: "b note" },
        { blockerId: "c", blockedId: "d", evidenceId: "d", note: "d note" },
      ]),
    );
    const base = [
      makeItem("a", { title: "Alpha job" }),
      makeItem("b", { lastActivityNote: "waiting on alpha" }),
      makeItem("c", { title: "Gamma job" }),
      makeItem("d", { lastActivityNote: "waiting on gamma" }),
    ];
    await inferDependencyEdges(base);

    // d's note changes, and a new item e appears; a, b and c are untouched.
    generateText.mockResolvedValueOnce(answer([{ blockerId: "e", blockedId: "d", evidenceId: "d", note: "now waits on e" }], 300));
    const edges = await inferDependencyEdges([
      ...base.slice(0, 3),
      makeItem("d", { lastActivityNote: "now waiting on the epsilon job" }),
      makeItem("e", { title: "Epsilon job" }),
    ]);

    const prompt = lastPrompt();
    expect(prompt).toContain('id="d"');
    expect(prompt).toContain("now waiting on the epsilon job");
    expect(prompt).toContain('id="e"');
    // Unchanged items appear by id and title only: their notes are not sent again.
    expect(prompt).toContain('id="a" | title="Alpha job"');
    expect(prompt).not.toContain("waiting on alpha");
    expect(edges.map((e) => `${e.blockerId}>${e.blockedId}`).sort()).toEqual(["a>b", "e>d"]);
    expect(getInferenceMeter()).toMatchObject({ calls: 2, incrementalCalls: 1, lastItemCount: 2 });
  });

  it("drops a remembered link whose justifying text changed and which the model no longer reports", async () => {
    generateText.mockResolvedValueOnce(answer([{ blockerId: "a", blockedId: "b", evidenceId: "b" }]));
    await inferDependencyEdges([makeItem("a"), makeItem("b", { lastActivityNote: "waiting on a" })]);

    generateText.mockResolvedValueOnce(answer([]));
    expect(await inferDependencyEdges([makeItem("a"), makeItem("b", { lastActivityNote: "no longer waiting" })])).toEqual([]);
  });

  it("keeps a link justified by an unchanged item when the other end changes", async () => {
    generateText.mockResolvedValueOnce(answer([{ blockerId: "a", blockedId: "b", evidenceId: "b" }]));
    await inferDependencyEdges([makeItem("a"), makeItem("b", { lastActivityNote: "waiting on a" }), makeItem("c")]);

    generateText.mockResolvedValueOnce(answer([]));
    const edges = await inferDependencyEdges([
      makeItem("a", { lastActivityNote: "shipped a draft" }),
      makeItem("b", { lastActivityNote: "waiting on a" }),
      makeItem("c"),
    ]);
    expect(edges.map((e) => `${e.blockerId}>${e.blockedId}`)).toEqual(["a>b"]);
  });

  it("ignores a link in an incremental answer whose justifying item was not shown in full", async () => {
    generateText.mockResolvedValueOnce(answer([]));
    const base = [makeItem("a"), makeItem("b"), makeItem("c")];
    await inferDependencyEdges(base);

    generateText.mockResolvedValueOnce(answer([{ blockerId: "a", blockedId: "b", evidenceId: "a" }]));
    expect(await inferDependencyEdges([...base, makeItem("d")])).toEqual([]);
  });

  it("drops remembered links when an end is no longer open", async () => {
    generateText.mockResolvedValueOnce(answer([{ blockerId: "a", blockedId: "b", evidenceId: "b" }]));
    await inferDependencyEdges([makeItem("a"), makeItem("b"), makeItem("c")]);

    expect(await inferDependencyEdges([makeItem("a", { isDone: true }), makeItem("b"), makeItem("c")])).toEqual([]);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("reads every item again once the full-refresh interval has passed", async () => {
    process.env.INFERENCE_FULL_REFRESH_MS = "0";
    generateText.mockResolvedValue(answer([]));
    const items = [makeItem("a"), makeItem("b")];

    await inferDependencyEdges(items);
    await inferDependencyEdges(items);

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(getInferenceMeter()).toMatchObject({ calls: 2, incrementalCalls: 0 });
  });

  it("falls back to the remembered links when a later call fails, and tries the same items again next time", async () => {
    generateText.mockResolvedValueOnce(answer([{ blockerId: "a", blockedId: "b", evidenceId: "b" }]));
    const base = [makeItem("a"), makeItem("b"), makeItem("c")];
    await inferDependencyEdges(base);

    generateText.mockRejectedValueOnce(new Error("boom"));
    const changed = [...base.slice(0, 2), makeItem("c", { lastActivityNote: "new text" })];
    expect((await inferDependencyEdges(changed)).map((e) => `${e.blockerId}>${e.blockedId}`)).toEqual(["a>b"]);

    generateText.mockResolvedValueOnce(answer([]));
    await inferDependencyEdges(changed);
    expect(lastPrompt()).toContain("new text");
    expect(getInferenceMeter()).toMatchObject({ calls: 3, failures: 1 });
  });
});
