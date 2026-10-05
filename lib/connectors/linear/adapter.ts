import "server-only";
import type { Connector } from "../types";
import type { DependencyEdge, Person, WorkItem } from "../../types";
import { rawLinearIssues, type LinearStateType, type RawLinearIssue } from "./fixtures";

const SOURCE = "linear";

function canonicalId(externalId: string): string {
  return `${SOURCE}:${externalId}`;
}

function toMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function toPerson(raw: NonNullable<RawLinearIssue["assignee"]>): Person {
  return {
    id: canonicalId(raw.id),
    name: raw.name,
    email: raw.email,
    sourceRefs: [{ source: SOURCE, externalId: raw.id }],
  };
}

/**
 * What each of Linear's workflow state types means for the canonical model.
 * `isDone` alone cannot separate "finished" from "dropped" (both mean no
 * longer needs action), so `outcome` carries the difference:
 * - completed -> delivered.
 * - canceled and duplicate -> abandoned: closed without delivering the work.
 * - triage, backlog, unstarted and started -> still open, no outcome.
 * A type this table does not know (the API types it as a free string) is
 * treated as open rather than guessed at. Another organization's tool will
 * have its own states, and its adapter owns that mapping.
 */
const OUTCOME_BY_STATE: Record<LinearStateType, "delivered" | "abandoned" | null> = {
  triage: null,
  backlog: null,
  unstarted: null,
  started: null,
  completed: "delivered",
  canceled: "abandoned",
  duplicate: "abandoned",
};

/** The newest comment by its own timestamp, so this does not depend on how the API orders a connection. */
function latestComment(raw: RawLinearIssue): string | null {
  const nodes = raw.comments?.nodes ?? [];
  if (nodes.length === 0) return null;
  return nodes.reduce((newest, node) => ((toMs(node.createdAt) ?? 0) >= (toMs(newest.createdAt) ?? 0) ? node : newest)).body;
}

export function toWorkItem(raw: RawLinearIssue): WorkItem {
  const outcome = OUTCOME_BY_STATE[raw.state.type] ?? null;
  const isDone = outcome !== null;
  return {
    id: canonicalId(raw.id),
    source: SOURCE,
    externalId: raw.id,
    title: raw.title,
    status: raw.state.name,
    isDone,
    outcome,
    assignee: raw.assignee ? toPerson(raw.assignee) : null,
    parent: raw.project ? { id: canonicalId(raw.project.id), title: raw.project.name } : null,
    scope: raw.description ?? null,
    team: raw.team?.name ?? null,
    url: raw.url,
    dueDateMs: toMs(raw.dueDate),
    createdMs: toMs(raw.createdAt),
    // Not invented when absent: a closed issue with neither timestamp has no close date.
    closedMs: isDone ? (toMs(raw.completedAt) ?? toMs(raw.canceledAt)) : null,
    updatedMs: toMs(raw.updatedAt),
    lastActivityNote: latestComment(raw),
  };
}

/**
 * Linear reports a dependency on both issues involved. The edge is read from
 * the blocked side: an `inverseRelations` node of type "blocks" names the
 * blocker in its `issue`. That is the inverse of ClickUp's and Salesforce's
 * `blocks` lists, so the edge is flipped here into the canonical
 * {blockerId, blockedId} direction. Other relation types (duplicate, related,
 * similar) are not dependencies.
 */
export function toDependencyEdges(issues: RawLinearIssue[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const issue of issues) {
    for (const relation of issue.inverseRelations?.nodes ?? []) {
      if (relation.type !== "blocks") continue;
      edges.push({ blockerId: canonicalId(relation.issue.id), blockedId: canonicalId(issue.id), confidence: "confirmed" });
    }
  }
  return edges;
}

/** Fixture-backed for now, like the other two connectors. */
export const linearConnector: Connector = {
  source: SOURCE,
  displayName: "Linear",

  async listPeople(): Promise<Person[]> {
    const byId = new Map<string, Person>();
    for (const issue of rawLinearIssues) {
      if (issue.assignee && !byId.has(issue.assignee.id)) byId.set(issue.assignee.id, toPerson(issue.assignee));
    }
    return Array.from(byId.values());
  },

  async listWorkItems(): Promise<WorkItem[]> {
    return rawLinearIssues.map(toWorkItem);
  },

  async listDependencyEdges(): Promise<DependencyEdge[]> {
    return toDependencyEdges(rawLinearIssues);
  },
};
