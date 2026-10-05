import "server-only";
import { inferredLinksFor, type InferredLink } from "./dependencies";
import { getWorkItemSeverity } from "./rules/severity";
import type { OpsSnapshot } from "./snapshot";
import type { Person, SeverityResult, WorkItem } from "./types";

const STALLED_STATUS_PATTERN = /on\s*hold|block/i;

export interface BottleneckItem {
  item: WorkItem;
  severity: SeverityResult;
  isStalled: boolean;
  /** People unblocked once this ships — confirmed dependencies only. */
  releasesWorkFor: Person[];
  /** AI-inferred, lower-confidence links this item might also be blocking — each confirmable via lib/actions/dependencies.ts. */
  inferredLinks: InferredLink[];
}

/**
 * Open items worth drilling into: explicitly stalled, red/amber severity, or
 * quietly blocking someone else's work even if not overdue yet. This is the
 * list the /bottlenecks page renders flat; each row's own detail (scope,
 * team, who's waiting) only appears once the operator expands it — the
 * progressive-disclosure rule this whole UI is built around.
 */
export function getBottlenecks(snapshot: OpsSnapshot): BottleneckItem[] {
  const rows: BottleneckItem[] = snapshot.workItems
    .filter((item) => !item.isDone)
    .map((item) => {
      const impact = snapshot.impactByItemId.get(item.id);

      return {
        item,
        severity: getWorkItemSeverity(item),
        isStalled: STALLED_STATUS_PATTERN.test(item.status),
        releasesWorkFor: impact?.releasesWorkFor ?? [],
        inferredLinks: inferredLinksFor(item.id, snapshot.inferredEdges, snapshot.workItemsById),
      };
    })
    .filter((row) => row.isStalled || row.severity.level !== "green" || row.releasesWorkFor.length > 0);

  return rows.sort((a, b) => impactScore(b) - impactScore(a));
}

function impactScore(row: BottleneckItem): number {
  const severityScore = row.severity.level === "red" ? 3 : row.severity.level === "amber" ? 1 : 0;
  return (row.isStalled ? 2 : 0) + row.releasesWorkFor.length * 2 + severityScore;
}
