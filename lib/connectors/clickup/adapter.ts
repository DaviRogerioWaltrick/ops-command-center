import "server-only";
import type { Connector } from "../types";
import type { DependencyEdge, Person, WorkItem } from "../../types";
import { rawClickUpTasks, type RawClickUpTask } from "./fixtures";

const SOURCE = "clickup";

function canonicalId(externalId: string): string {
  return `${SOURCE}:${externalId}`;
}

function toPerson(raw: NonNullable<RawClickUpTask["assignee"]>): Person {
  return {
    id: canonicalId(raw.id),
    name: raw.name,
    email: raw.email,
    sourceRefs: [{ source: SOURCE, externalId: raw.id }],
  };
}

function toWorkItem(raw: RawClickUpTask): WorkItem {
  return {
    id: canonicalId(raw.id),
    source: SOURCE,
    externalId: raw.id,
    title: raw.name,
    status: raw.status,
    isDone: raw.isDoneStatus,
    assignee: raw.assignee ? toPerson(raw.assignee) : null,
    parent: raw.parentId && raw.parentName ? { id: canonicalId(raw.parentId), title: raw.parentName } : null,
    scope: raw.description ?? null,
    team: raw.team ?? null,
    url: raw.url,
    dueDateMs: raw.dueDateMs,
    createdMs: raw.createdMs,
    closedMs: raw.closedMs,
    updatedMs: raw.updatedMs,
    lastActivityNote: raw.lastComment ?? null,
  };
}

/**
 * Fixture-backed for now (see lib/connectors/clickup/fixtures.ts). Swapping
 * to a live workspace later means replacing `rawClickUpTasks` with a real
 * `clickupFetch` pull — this mapping layer and everything downstream doesn't
 * change.
 */
export const clickUpConnector: Connector = {
  source: SOURCE,
  displayName: "ClickUp",

  async listPeople(): Promise<Person[]> {
    const byId = new Map<string, Person>();
    for (const task of rawClickUpTasks) {
      if (task.assignee && !byId.has(task.assignee.id)) {
        byId.set(task.assignee.id, toPerson(task.assignee));
      }
    }
    return Array.from(byId.values());
  },

  async listWorkItems(): Promise<WorkItem[]> {
    return rawClickUpTasks.map(toWorkItem);
  },

  async listDependencyEdges(): Promise<DependencyEdge[]> {
    const edges: DependencyEdge[] = [];
    for (const task of rawClickUpTasks) {
      for (const blockedExternalId of task.blocks ?? []) {
        edges.push({
          blockerId: canonicalId(task.id),
          blockedId: canonicalId(blockedExternalId),
          confidence: "confirmed",
        });
      }
    }
    return edges;
  },
};
