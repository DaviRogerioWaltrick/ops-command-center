import "server-only";
import type { DependencyImpact } from "./dependencies";
import type { Person, WorkItem, WorkloadSnapshot } from "./types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-person workload rollup, computed live from the current WorkItem set.
 * This is the in-memory shape of what lib/db/schema.ts's `workloadSnapshots`
 * table will persist once a database is provisioned — capturing this same
 * computation on a schedule is what turns "workload right now" into
 * "workload trend over time" (see README's Phase 4 note). Until then, this
 * function is the whole story: no history, just the current snapshot.
 */
export function computeWorkloadSnapshots(
  people: Person[],
  workItems: WorkItem[],
  impactByItemId: Map<string, DependencyImpact>,
): WorkloadSnapshot[] {
  const now = Date.now();

  return people.map((person) => {
    const owned = workItems.filter((item) => item.assignee?.id === person.id);
    const open = owned.filter((item) => !item.isDone);
    const overdue = open.filter((item) => item.dueDateMs != null && item.dueDateMs < now);
    const closedLast7d = owned.filter(
      (item) =>
        item.isDone && item.outcome !== "abandoned" && item.closedMs != null && item.closedMs >= now - SEVEN_DAYS_MS,
    );
    const blockingOthers = open.filter((item) => (impactByItemId.get(item.id)?.blockedItemIds.length ?? 0) > 0);

    return {
      personId: person.id,
      capturedAtMs: now,
      openCount: open.length,
      overdueCount: overdue.length,
      closedLast7d: closedLast7d.length,
      blockingOthersCount: blockingOthers.length,
    };
  });
}
