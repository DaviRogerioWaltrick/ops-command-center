import { describe, expect, it } from "vitest";
import { getWorkItemSeverity, severityFromDaysOverdue, worstLevel } from "./severity";
import type { WorkItem } from "../types";

const DAY_MS = 86_400_000;

function makeItem(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: "x:1",
    source: "x",
    externalId: "1",
    title: "test item",
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

describe("severityFromDaysOverdue", () => {
  it("is green when not overdue", () => {
    expect(severityFromDaysOverdue(0).level).toBe("green");
  });
  it("is amber for 1-7 days overdue", () => {
    expect(severityFromDaysOverdue(1).level).toBe("amber");
    expect(severityFromDaysOverdue(7).level).toBe("amber");
  });
  it("is red past 7 days overdue", () => {
    expect(severityFromDaysOverdue(8).level).toBe("red");
  });
});

describe("getWorkItemSeverity", () => {
  it("is green when done, regardless of due date", () => {
    const item = makeItem({ isDone: true, dueDateMs: Date.now() - 30 * DAY_MS });
    expect(getWorkItemSeverity(item)).toEqual({ level: "green", reason: "Completed" });
  });

  it("is green when no due date is set", () => {
    const item = makeItem({ dueDateMs: null });
    expect(getWorkItemSeverity(item).level).toBe("green");
  });

  it("grades an open, overdue item by days overdue", () => {
    const item = makeItem({ dueDateMs: Date.now() - 10 * DAY_MS });
    expect(getWorkItemSeverity(item).level).toBe("red");
  });

  it("never special-cases a source-specific field — only isDone/dueDateMs matter", () => {
    // Guards the design intent: this must stay connector-agnostic. Any source-specific override
    // belongs in that connector's own mapping, not here.
    const item = makeItem({ dueDateMs: Date.now() + DAY_MS, status: "anything ClickUp or Salesforce might call it" });
    expect(getWorkItemSeverity(item).level).toBe("green");
  });
});

describe("worstLevel", () => {
  it("prefers red over amber over green", () => {
    expect(worstLevel(["green", "amber", "red"])).toBe("red");
    expect(worstLevel(["green", "amber"])).toBe("amber");
    expect(worstLevel(["green"])).toBe("green");
    expect(worstLevel([])).toBe("green");
  });
});
