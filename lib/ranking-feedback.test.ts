import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_CONTEXT_LENGTH,
  addRankingFeedback,
  clearRankingFeedbackForTests,
  listFeedbackForItem,
  parseFeedbackForm,
} from "./ranking-feedback";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseFeedbackForm", () => {
  it("accepts both verdicts, trims the context, and turns an empty context into null", () => {
    expect(parseFeedbackForm(form({ workItemId: "a", verdict: "agree", context: "  hello  " }))).toEqual({
      workItemId: "a",
      verdict: "agree",
      context: "hello",
    });
    expect(parseFeedbackForm(form({ workItemId: "a", verdict: "rank_should_differ", context: "   " }))?.context).toBeNull();
    expect(parseFeedbackForm(form({ workItemId: "a", verdict: "rank_should_differ" }))?.context).toBeNull();
  });

  it("rejects a missing id, an unknown verdict, or no verdict", () => {
    expect(parseFeedbackForm(form({ verdict: "agree" }))).toBeNull();
    expect(parseFeedbackForm(form({ workItemId: "a", verdict: "maybe" }))).toBeNull();
    expect(parseFeedbackForm(form({ workItemId: "a" }))).toBeNull();
  });

  it("caps the context length", () => {
    const parsed = parseFeedbackForm(form({ workItemId: "a", verdict: "agree", context: "x".repeat(MAX_CONTEXT_LENGTH + 500) }));
    expect(parsed?.context).toHaveLength(MAX_CONTEXT_LENGTH);
  });
});

describe("ranking feedback store", () => {
  beforeEach(() => clearRankingFeedbackForTests());

  const base = { rankAtTime: 3, rankSource: "ai" as const, reasoningAtTime: "why" };

  it("keeps every verdict for an item, newest first, and separates items", async () => {
    await addRankingFeedback({ ...base, workItemId: "a", verdict: "agree", context: null });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await addRankingFeedback({ ...base, workItemId: "a", verdict: "rank_should_differ", context: "too high" });
    await addRankingFeedback({ ...base, workItemId: "b", verdict: "agree", context: null });

    const forA = await listFeedbackForItem("a");
    expect(forA.map((r) => r.verdict)).toEqual(["rank_should_differ", "agree"]);
    expect(forA[0].rankAtTime).toBe(3);
    expect(await listFeedbackForItem("b")).toHaveLength(1);
    expect(await listFeedbackForItem("none")).toEqual([]);
  });
});
