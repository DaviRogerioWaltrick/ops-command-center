import type { Person, PriorityRankingEntry, WorkItem } from "./types";
import type { DependencyImpact, InferenceMeter } from "./dependencies";

/**
 * Pure read-models for the drill-down pages (command view, department,
 * person, item). Nothing here touches a connector, the AI, or a database:
 * each function takes already-built data and returns what a page displays,
 * so every number on screen is testable and traceable to WorkItem fields.
 *
 * Anything that would need history (trends over months) or data no source
 * supplies yet (cost) is deliberately NOT computed here; the pages show an
 * explicit gap instead. See MANIFESTO.md's honesty rule.
 */

const DAY_MS = 86_400_000;

/** "Department" in the UI is the WorkItem.team field. A real organization may call it team, function or something else. */
export const NO_TEAM = "No team set";

export const teamOf = (item: WorkItem): string => item.team?.trim() || NO_TEAM;

/** A finished item that was actually delivered. Sources that do not distinguish outcomes (outcome undefined) count as delivered, as elsewhere. */
export const isDelivered = (item: WorkItem): boolean => item.isDone && item.outcome !== "abandoned";

const isOverdue = (item: WorkItem, now: number): boolean => !item.isDone && item.dueDateMs != null && item.dueDateMs < now;

export interface RateResult {
  /** 0..1, or null when there is no qualifying history. */
  rate: number | null;
  sample: number;
}

/** Share of delivered items (with both a due date and a close date) closed on or before the due date. */
export function onTimeRate(items: WorkItem[]): RateResult {
  const eligible = items.filter((i) => isDelivered(i) && i.dueDateMs != null && i.closedMs != null);
  if (eligible.length === 0) return { rate: null, sample: 0 };
  const onTime = eligible.filter((i) => i.closedMs! <= i.dueDateMs!).length;
  return { rate: onTime / eligible.length, sample: eligible.length };
}

export interface CycleResult {
  days: number | null;
  sample: number;
}

/** Mean days from created to closed across delivered items. A definition choice (created-to-closed), shown with its sample size. */
export function averageCycleDays(items: WorkItem[]): CycleResult {
  const eligible = items.filter(
    (i) => isDelivered(i) && i.createdMs != null && i.closedMs != null && i.closedMs >= i.createdMs,
  );
  if (eligible.length === 0) return { days: null, sample: 0 };
  const total = eligible.reduce((sum, i) => sum + (i.closedMs! - i.createdMs!), 0);
  return { days: total / eligible.length / DAY_MS, sample: eligible.length };
}

/** Open items currently waiting on an open blocker, via confirmed edges only. */
export function blockedOpenItemIds(impactByItemId: Map<string, DependencyImpact>): Set<string> {
  const ids = new Set<string>();
  for (const impact of impactByItemId.values()) for (const id of impact.blockedItemIds) ids.add(id);
  return ids;
}

export interface ScopeStats {
  open: number;
  overdue: number;
  /** Distinct people with at least one open item waiting on a confirmed open blocker. */
  peopleBlocked: number;
  cycle: CycleResult;
}

export function computeScopeStats(
  items: WorkItem[],
  impactByItemId: Map<string, DependencyImpact>,
  now: number,
): ScopeStats {
  const open = items.filter((i) => !i.isDone);
  const blockedIds = blockedOpenItemIds(impactByItemId);
  const blockedPeople = new Set(
    open.filter((i) => blockedIds.has(i.id) && i.assignee).map((i) => i.assignee!.id),
  );
  return {
    open: open.length,
    overdue: open.filter((i) => isOverdue(i, now)).length,
    peopleBlocked: blockedPeople.size,
    cycle: averageCycleDays(items),
  };
}

export interface DepartmentRow {
  team: string;
  open: number;
  overdue: number;
}

export function buildDepartmentRows(items: WorkItem[], now: number): DepartmentRow[] {
  const byTeam = new Map<string, DepartmentRow>();
  for (const item of items) {
    if (item.isDone) continue;
    const team = teamOf(item);
    const row = byTeam.get(team) ?? { team, open: 0, overdue: 0 };
    row.open += 1;
    if (isOverdue(item, now)) row.overdue += 1;
    byTeam.set(team, row);
  }
  return [...byTeam.values()].sort((a, b) => b.open - a.open || a.team.localeCompare(b.team));
}

export interface PersonRow {
  person: Person;
  open: number;
  overdue: number;
  /** Open items of theirs that are a confirmed blocker for someone else's open work. */
  blockingOthers: number;
  onTime: RateResult;
  teams: string[];
}

/** One row per person who owns at least one item in `items` (so a scoped call only lists people active in that scope). */
export function buildPersonRows(
  people: Person[],
  items: WorkItem[],
  impactByItemId: Map<string, DependencyImpact>,
  now: number,
): PersonRow[] {
  const rows: PersonRow[] = [];
  for (const person of people) {
    const owned = items.filter((i) => i.assignee?.id === person.id);
    if (owned.length === 0) continue;
    const open = owned.filter((i) => !i.isDone);
    rows.push({
      person,
      open: open.length,
      overdue: open.filter((i) => isOverdue(i, now)).length,
      blockingOthers: open.filter((i) => (impactByItemId.get(i.id)?.blockedItemIds.length ?? 0) > 0).length,
      onTime: onTimeRate(owned),
      teams: [...new Set(owned.map(teamOf))].sort(),
    });
  }
  return rows.sort((a, b) => b.open - a.open || a.person.name.localeCompare(b.person.name));
}

export interface AxisReadout {
  time: string;
  scope: string;
  /** Null means the data does not exist; the page must say so rather than show a number. */
  resource: string | null;
}

/**
 * The time / resource / scope readout, restricted to what the
 * data supports. Time comes from the due date, scope from the dependency
 * graph, and resource only when both tracked and estimated time exist (cost
 * is never shown: no source supplies it, and rates are sensitive). No axis is
 * normalised to a score, since any scale would be invented.
 */
export function describeAxes(
  item: WorkItem,
  impact: DependencyImpact | undefined,
  inferredBlockingCount: number,
  now: number,
  abandonedBlockerCount = 0,
): AxisReadout {
  let time: string;
  if (item.isDone) time = "Finished";
  else if (item.dueDateMs == null) time = "No due date set";
  else {
    const days = Math.floor((now - item.dueDateMs) / DAY_MS);
    time = days >= 1 ? `${days} day${days === 1 ? "" : "s"} overdue` : days === 0 ? "Due today" : `Due in ${-days} day${-days === 1 ? "" : "s"}`;
  }

  const released = impact?.releasesWorkFor.length ?? 0;
  const parts: string[] = [];
  if (released > 0) parts.push(`releases work for ${released} ${released === 1 ? "person" : "people"}`);
  else parts.push("blocks no one (confirmed)");
  if (inferredBlockingCount > 0) parts.push(`${inferredBlockingCount} more AI-inferred`);
  if (abandonedBlockerCount > 0) parts.push(`needs re-planning: waiting on ${abandonedBlockerCount} abandoned item${abandonedBlockerCount === 1 ? "" : "s"}`);

  const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
  const resource =
    item.timeTrackedMs != null && item.estimatedDurationMs != null
      ? `${hours(item.timeTrackedMs)} h tracked of ${hours(item.estimatedDurationMs)} h estimated`
      : null;

  return { time, scope: parts.join(", "), resource };
}

/** Open confirmed blockers of an item (what it is waiting on). */
export function openBlockersOf(
  itemId: string,
  impactByItemId: Map<string, DependencyImpact>,
  workItemsById: Map<string, WorkItem>,
): WorkItem[] {
  const blockers: WorkItem[] = [];
  for (const [blockerId, impact] of impactByItemId) {
    if (impact.blockedItemIds.includes(itemId)) {
      const blocker = workItemsById.get(blockerId);
      if (blocker) blockers.push(blocker);
    }
  }
  return blockers;
}

/** A department view lists its top 5 ranked items and nothing more. */
export const DEPARTMENT_TOP = 5;
/** The company-wide view lists its top 5 by default and offers the top 10 from a menu. */
export const COMPANY_TOP_OPTIONS = [5, 10] as const;

/** How many ranked items a view lists. A department scope is always 5; the company-wide scope takes 5 or 10 from the page's `top` parameter and falls back to 5 for anything else. */
export function topLimit(dept: string | null, requested: unknown): number {
  if (dept) return DEPARTMENT_TOP;
  const wanted = Number(Array.isArray(requested) ? requested[0] : requested);
  return COMPANY_TOP_OPTIONS.find((option) => option === wanted) ?? COMPANY_TOP_OPTIONS[0];
}

/**
 * The dependency-check usage line for the command view, in plain words. `failure` is set only when a call failed;
 * the cause is the meter's own description (error class, status, request id), never item text. Token counts leave
 * out failed requests, so the provider dashboard stays the billing record.
 */
export function describeInferenceUsage(meter: InferenceMeter): { usage: string; failure: string | null } {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const usage =
    `Dependency check since the server started: ${n(meter.calls, "request", "requests")}` +
    ` (${meter.incrementalCalls} on new or changed items only), ${n(meter.reusedRebuilds, "rebuild", "rebuilds")} reused without a request,` +
    ` ${meter.failures} failed, ${meter.inputTokens.toLocaleString("en-US")} input and ${meter.outputTokens.toLocaleString("en-US")} output tokens.` +
    ` The token counts leave out failed requests, so the provider dashboard is the billing record.`;
  const failure =
    meter.failures > 0
      ? `The dependency check failed ${n(meter.failures, "time", "times")} and kept the links it already had. Last cause: ${meter.lastFailure ?? "unknown"}.`
      : null;
  return { usage, failure };
}

/** The first `limit` of an already-sorted list, with the full count so a page can say how many are not listed. */
export function takeTop<T>(sorted: T[], limit: number): { shown: T[]; total: number } {
  return { shown: sorted.slice(0, Math.max(0, limit)), total: sorted.length };
}

/** Distinct tie groups among the given entries whose order the operator has not yet chosen. Pass only the entries on screen. */
export function countTiesToDecide(entries: PriorityRankingEntry[]): number {
  return new Set(entries.filter((entry) => entry.probabilistic?.needsDecision).map((entry) => entry.probabilistic!.tieGroup)).size;
}

/** Request-time clock for server-rendered pages. A named helper because these pages are force-dynamic and read "now" on purpose. */
export const currentTimeMs = (): number => Date.now();
