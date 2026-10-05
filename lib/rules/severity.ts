import "server-only";
import type { RagLevel, SeverityResult, WorkItem } from "../types";

const MS_PER_DAY = 86_400_000;

/** Maps how many days something is overdue to a RAG level + human reason. Connector-agnostic. */
export function severityFromDaysOverdue(daysOverdue: number): SeverityResult {
  if (daysOverdue > 7) return { level: "red", reason: `${daysOverdue} days overdue` };
  if (daysOverdue >= 1) {
    return { level: "amber", reason: `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue` };
  }
  return { level: "green", reason: "On track" };
}

/**
 * Rule-based RAG severity for a canonical WorkItem. Deliberately reads
 * nothing but the fields every connector already normalizes (isDone,
 * dueDateMs) — no source-specific custom-field lookups here. A
 * connector that wants to feed in its own "marked delayed" signal should
 * normalize it into WorkItem.status/isDone during mapping, not by adding a
 * special case here.
 */
export function getWorkItemSeverity(item: WorkItem): SeverityResult {
  if (item.isDone) return { level: "green", reason: "Completed" };
  if (item.dueDateMs == null) return { level: "green", reason: "No due date set" };
  const daysOverdue = Math.floor((Date.now() - item.dueDateMs) / MS_PER_DAY);
  return severityFromDaysOverdue(daysOverdue);
}

/** Worst (most urgent) level present in a set — red beats amber beats green. */
export function worstLevel(levels: RagLevel[]): RagLevel {
  if (levels.includes("red")) return "red";
  if (levels.includes("amber")) return "amber";
  return "green";
}
