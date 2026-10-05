import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildJevState,
  clearJevCache,
  createAsk,
  describeEntry,
  describeFailure,
  getJevMeter,
  rankWorkItemsProbabilistic,
  resetJevMeter,
  type AskJev,
  type SystemOneClient,
} from "./jev";
import type { ItemJudgment } from "./probabilistic";
import type { WorkItemFact } from "./facts";
import type { WorkItem } from "../types";

function makeFact(id: string, overrides: Partial<WorkItemFact> = {}, itemOverrides: Partial<WorkItem> = {}): WorkItemFact {
  const item: WorkItem = {
    id,
    source: "test",
    externalId: id,
    title: `Title ${id}`,
    status: "open",
    isDone: false,
    assignee: null,
    url: "https://example.com",
    dueDateMs: 1_700_000_000_000,
    createdMs: null,
    closedMs: null,
    updatedMs: null,
    ...itemOverrides,
  };
  return {
    item,
    severity: { level: "green", reason: "On track" },
    releasesWorkForNames: [],
    inferredBlockingNotes: [],
    ownerOpenCount: 9,
    ownerOverdueCount: 4,
    daysUntilDue: 3,
    abandonedBlockers: [],
    abandonedTrackedMs: null,
    ...overrides,
  };
}

const level = (n: number) => ({ probabilities: [0, 1, 2, 3, 4].map((i) => (i === n ? 1 : 0)), confidence: 1 });
const fixedJudgment = (lev: number): ItemJudgment => ({ leverage: level(lev), slipRisk: level(0) });
const usage = { input_tokens: 100, output_tokens: 5 };

beforeEach(() => {
  clearJevCache();
  resetJevMeter();
});

describe("buildJevState", () => {
  it("sends only semantic fields and no dates, counts or other numbers", () => {
    const state = buildJevState(makeFact("a", { releasesWorkForNames: ["Ana"] }, { scope: "Ship it", lastActivityNote: "Waiting on legal" }));
    expect(state).toEqual({
      title: "Title a",
      status: "open",
      scope: "Ship it",
      latest_note: "Waiting on legal",
      people_released: ["Ana"],
    });
    expect(JSON.stringify(state)).not.toMatch(/\d{4,}/);
  });

  it("labels inferred links as unconfirmed hints and keeps abandoned-work reasons", () => {
    const state = buildJevState(
      makeFact("a", {
        inferredBlockingNotes: ["might block B"],
        abandonedBlockers: [{ title: "Old task", note: "Canceled by client" }, { title: "Other", note: null }],
      }),
    );
    expect(state.unconfirmed_hints).toEqual(["might block B"]);
    expect(state.waiting_on_abandoned_work).toEqual([
      { title: "Old task", why_dropped: "Canceled by client" },
      { title: "Other", why_dropped: "not recorded" },
    ]);
  });
});

describe("createAsk", () => {
  it("maps SDK answers into estimates and usage", async () => {
    const systemOne = vi.fn().mockResolvedValue({
      answers: {
        leverage: { probabilities: { "0": 0.1, "1": 0.1, "2": 0.1, "3": 0.2, "4": 0.5 }, confidence: 0.6 },
        slipRisk: { probabilities: { "0": 1, "1": 0, "2": 0, "3": 0, "4": 0 }, confidence: 1 },
      },
      usage,
    });
    const ask = createAsk({ systemOne } as unknown as SystemOneClient);
    const out = await ask({ title: "x" });
    expect(out.judgment.leverage.probabilities).toEqual([0.1, 0.1, 0.1, 0.2, 0.5]);
    expect(out.judgment.slipRisk.confidence).toBe(1);
    expect(out.usage).toEqual(usage);
    const request = systemOne.mock.calls[0][0];
    expect(request.state).toEqual({ title: "x" });
    expect(Object.keys(request.questions)).toEqual(["leverage", "slipRisk"]);
    expect(request.questions.leverage.type).toBe("score");
    expect(request.questions.leverage.criteria).toHaveLength(5);
    expect(request.questions.slipRisk.criteria).toHaveLength(5);
  });

  it("turns a missing level into NaN so validation rejects it", async () => {
    const systemOne = vi.fn().mockResolvedValue({
      answers: {
        leverage: { probabilities: { "0": 1 }, confidence: 1 },
        slipRisk: { probabilities: { "0": 1, "1": 0, "2": 0, "3": 0, "4": 0 }, confidence: 1 },
      },
      usage,
    });
    const out = await createAsk({ systemOne } as unknown as SystemOneClient)({ title: "x" });
    expect(Number.isNaN(out.judgment.leverage.probabilities[2])).toBe(true);
  });
});

describe("rankWorkItemsProbabilistic", () => {
  const facts = [makeFact("a"), makeFact("b"), makeFact("c")];

  it("ranks by the judgments and meters tokens", async () => {
    const levels: Record<string, number> = { a: 1, b: 4, c: 2 };
    const ask: AskJev = vi.fn(async (state) => ({
      judgment: fixedJudgment(levels[String(state.title).replace("Title ", "")]),
      usage,
    }));
    const ranked = await rankWorkItemsProbabilistic(facts, { ask, runs: 200 });
    expect(ranked?.map((r) => r.workItemId)).toEqual(["b", "c", "a"]);
    expect(ranked?.every((r) => r.source === "probabilistic")).toBe(true);
    expect(getJevMeter()).toMatchObject({ requests: 3, cacheHits: 0, failures: 0, inputTokens: 300, outputTokens: 15 });
  });

  it("asks again only for items whose state changed", async () => {
    const ask: AskJev = vi.fn(async () => ({ judgment: fixedJudgment(2), usage }));
    await rankWorkItemsProbabilistic(facts, { ask, runs: 50 });
    expect(ask).toHaveBeenCalledTimes(3);
    await rankWorkItemsProbabilistic(facts, { ask, runs: 50 });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(getJevMeter().cacheHits).toBe(3);
    const changed = [facts[0], facts[1], makeFact("c", {}, { lastActivityNote: "New note" })];
    await rankWorkItemsProbabilistic(changed, { ask, runs: 50 });
    expect(ask).toHaveBeenCalledTimes(4);
  });

  it("does not re-ask when only deterministic facts change (they never reach Jev)", async () => {
    const ask: AskJev = vi.fn(async () => ({ judgment: fixedJudgment(2), usage }));
    await rankWorkItemsProbabilistic([makeFact("a")], { ask, runs: 50 });
    await rankWorkItemsProbabilistic([makeFact("a", { daysUntilDue: -20, ownerOverdueCount: 12 })], { ask, runs: 50 });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("returns null, with no partial result, when any item fails", async () => {
    const ask: AskJev = vi.fn(async (state) => {
      if (state.title === "Title b") throw new Error("503");
      return { judgment: fixedJudgment(2), usage };
    });
    expect(await rankWorkItemsProbabilistic(facts, { ask, runs: 50 })).toBeNull();
    expect(getJevMeter()).toMatchObject({ failures: 1, fallbacks: 1 });
  });

  it("counts every failed request, but one fallback per pass, and adds no tokens for failed requests", async () => {
    const four = ["a", "b", "c", "d"].map((id) => makeFact(id));
    const ask: AskJev = vi.fn(async () => {
      throw new Error("503");
    });
    expect(await rankWorkItemsProbabilistic(four, { ask, runs: 50 })).toBeNull();
    // All four workers had a request in flight when the first failed, so all four failed.
    expect(getJevMeter()).toMatchObject({ requests: 4, failures: 4, fallbacks: 1, inputTokens: 0, outputTokens: 0 });
    expect(getJevMeter().lastFailure).toBe("Error: 503");
  });

  it("stops starting requests after the first failure, and keeps what was already paid for", async () => {
    const many = Array.from({ length: 10 }, (_, i) => makeFact(`i${i}`));
    let failFirst = true;
    const ask: AskJev = vi.fn(async (state) => {
      if (failFirst && state.title === "Title i0") throw new Error("503");
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { judgment: fixedJudgment(2), usage };
    });
    expect(await rankWorkItemsProbabilistic(many, { ask, runs: 50 })).toBeNull();
    // Only the four requests already in flight when i0 failed (concurrency 4); none of the other six were started.
    expect(ask).toHaveBeenCalledTimes(4);
    // The three that succeeded are metered even though the caller got null.
    expect(getJevMeter()).toMatchObject({ requests: 4, failures: 1, fallbacks: 1, inputTokens: 300, outputTokens: 15 });

    // A retry reuses those three and asks only for the failed item and the six never started.
    failFirst = false;
    expect(await rankWorkItemsProbabilistic(many, { ask, runs: 50 })).not.toBeNull();
    expect(ask).toHaveBeenCalledTimes(4 + 7);
    expect(getJevMeter().cacheHits).toBe(3);
  });

  it("records what failed without logging the item state", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    class RateLimitError extends Error {
      status = 429;
      requestId = "req_abc";
      body = { echoed: "Title a" };
    }
    const ask: AskJev = vi.fn(async () => {
      throw new RateLimitError("rate limit exceeded for Title a");
    });
    expect(await rankWorkItemsProbabilistic([makeFact("a")], { ask, runs: 50 })).toBeNull();
    expect(getJevMeter().lastFailure).toBe("RateLimitError, HTTP 429, request req_abc");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).not.toContain("Title a");
    spy.mockRestore();
  });

  it("returns null on an unusable answer and does not cache it", async () => {
    const bad: AskJev = vi.fn(async () => ({
      judgment: { leverage: { probabilities: [1, 0], confidence: 1 }, slipRisk: level(0) },
      usage,
    }));
    expect(await rankWorkItemsProbabilistic([makeFact("a")], { ask: bad, runs: 50 })).toBeNull();
    const good: AskJev = vi.fn(async () => ({ judgment: fixedJudgment(2), usage }));
    expect(await rankWorkItemsProbabilistic([makeFact("a")], { ask: good, runs: 50 })).not.toBeNull();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("over the item cap, asks about only the best items by exact facts and ranks the rest below them", async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeFact(`i${i}`, i === 7 ? { severity: { level: "red", reason: "late" }, daysUntilDue: -9 } : {}),
    );
    const asked: string[] = [];
    const ask: AskJev = vi.fn(async (state) => {
      asked.push(String(state.title));
      return { judgment: fixedJudgment(2), usage };
    });
    const ranked = await rankWorkItemsProbabilistic(many, { ask, maxItems: 4, runs: 50 });
    expect(ask).toHaveBeenCalledTimes(4);
    expect(asked).toContain("Title i7"); // the item with the strongest exact facts is always asked about
    expect(ranked).toHaveLength(10);
    expect(ranked!.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ranked![0].workItemId).toBe("i7");
    const assessed = ranked!.slice(0, 4);
    const rest = ranked!.slice(4);
    expect(assessed.every((r) => r.probabilistic && !r.unassessed)).toBe(true);
    expect(rest.every((r) => !r.probabilistic && r.unassessed && r.source === "probabilistic")).toBe(true);
    expect(rest[0].unassessed).toMatchObject({ assessed: 4, total: 10 });
    expect(rest[0].reasoning).toMatch(/not assessed by the model/);
  });

  it("keeps ranking when every item is within the cap, with nothing marked unassessed", async () => {
    const ask: AskJev = vi.fn(async () => ({ judgment: fixedJudgment(2), usage }));
    const ranked = await rankWorkItemsProbabilistic(facts, { ask, maxItems: 3, runs: 50 });
    expect(ranked).toHaveLength(3);
    expect(ranked!.every((r) => !r.unassessed)).toBe(true);
  });

  it("returns null without an API key when no ask is injected, and [] for no items", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await rankWorkItemsProbabilistic(facts)).toBeNull();
    vi.unstubAllEnvs();
    expect(await rankWorkItemsProbabilistic([])).toEqual([]);
  });
});

describe("describeFailure", () => {
  it("describes SDK-style errors by class, status and request id, never by message or body", () => {
    class InternalServerError extends Error {
      status = 503;
      requestId = "req_1";
    }
    expect(describeFailure(new InternalServerError("secret message"))).toBe("InternalServerError, HTTP 503, request req_1");
    class APIConnectionError extends Error {}
    expect(describeFailure(new APIConnectionError("connection reset: Title a"))).toBe("APIConnectionError");
  });

  it("keeps the message only for a plain Error from this codebase's own validation, truncated", () => {
    expect(describeFailure(new Error("a leverage probabilities sum to 0.5, expected 1"))).toBe(
      "Error: a leverage probabilities sum to 0.5, expected 1",
    );
    expect(describeFailure(new Error("x".repeat(500))).length).toBeLessThanOrEqual(207);
  });

  it("handles a non-Error throw", () => {
    expect(describeFailure("boom")).toBe("unknown error");
  });
});

describe("describeEntry", () => {
  it("states the rule facts and the model's most likely read as an estimate", () => {
    const text = describeEntry(makeFact("a", { releasesWorkForNames: ["Ana"] }), {
      leverage: { probabilities: [0, 0, 0.2, 0.7, 0.1], confidence: 0.5 },
      slipRisk: { probabilities: [0.9, 0.1, 0, 0, 0], confidence: 0.9 },
    });
    expect(text).toContain("releases work for Ana");
    expect(text).toContain('model estimate: leverage most likely "significant" (70%)');
    expect(text).toContain('slip risk most likely "healthy" (90%)');
  });
});
