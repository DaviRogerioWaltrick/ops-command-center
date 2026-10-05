import "server-only";
import { getWorkItemSeverity } from "../rules/severity";
import type { DependencyImpact } from "../dependencies";
import type { DependencyEdge, SeverityResult, WorkItem, WorkloadSnapshot } from "../types";

export interface WorkItemFact {
  item: WorkItem;
  severity: SeverityResult;
  /** Names of people whose work opens up once this item ships (confirmed dependencies only). */
  releasesWorkForNames: string[];
  /** Notes from AI-inferred (lower-confidence) dependencies where this item is the blocker. */
  inferredBlockingNotes: string[];
  ownerOpenCount: number | null;
  ownerOverdueCount: number | null;
  /** Whole days until the due date; negative once overdue; null with no due date. Computed for every open item. */
  daysUntilDue: number | null;
  /**
   * Finished blockers that were abandoned, not delivered (confirmed edges
   * only). The item's dependency premise is gone, so it needs a keep /
   * re-scope / drop decision. `note` is the abandoned item's last activity
   * text, which usually says why it was dropped.
   */
  abandonedBlockers: { title: string; note: string | null }[];
  /** Sum of time already tracked on the abandoned blockers; null unless every one of them has tracked time (never a partial sum). */
  abandonedTrackedMs: number | null;
}

const DAY_MS = 86_400_000;

/** Deterministic per-item facts — the substrate both the rule-based ranking and the AI prompt are built from. Never itself a verdict. */
export function buildWorkItemFacts(
  workItems: WorkItem[],
  impactByItemId: Map<string, DependencyImpact>,
  inferredEdges: DependencyEdge[],
  workloadByPersonId: Map<string, WorkloadSnapshot>,
  abandonedBlockersByItemId: Map<string, WorkItem[]> = new Map(),
  now: number = Date.now(),
): WorkItemFact[] {
  return workItems
    .filter((item) => !item.isDone)
    .map((item) => {
      const impact = impactByItemId.get(item.id);
      const inferredBlockingNotes = inferredEdges
        .filter((e) => e.blockerId === item.id)
        .map((e) => e.note ?? "")
        .filter(Boolean);
      const workload = item.assignee ? workloadByPersonId.get(item.assignee.id) : undefined;
      const abandoned = abandonedBlockersByItemId.get(item.id) ?? [];

      return {
        item,
        severity: getWorkItemSeverity(item),
        releasesWorkForNames: impact?.releasesWorkFor.map((p) => p.name) ?? [],
        inferredBlockingNotes,
        ownerOpenCount: workload?.openCount ?? null,
        ownerOverdueCount: workload?.overdueCount ?? null,
        daysUntilDue: item.dueDateMs == null ? null : -Math.floor((now - item.dueDateMs) / DAY_MS),
        abandonedBlockers: abandoned.map((b) => ({ title: b.title, note: b.lastActivityNote ?? null })),
        abandonedTrackedMs:
          abandoned.length > 0 && abandoned.every((b) => b.timeTrackedMs != null)
            ? abandoned.reduce((sum, b) => sum + b.timeTrackedMs!, 0)
            : null,
      };
    });
}
