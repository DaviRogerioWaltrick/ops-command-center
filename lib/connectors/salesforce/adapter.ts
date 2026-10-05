import "server-only";
import type { Connector } from "../types";
import type { DependencyEdge, Person, WorkItem } from "../../types";
import { rawSalesforceRecords, type RawSalesforceRecord } from "./fixtures";

const SOURCE = "salesforce";

function canonicalId(externalId: string): string {
  return `${SOURCE}:${externalId}`;
}

function toPerson(raw: RawSalesforceRecord): Person {
  return {
    id: canonicalId(raw.ownerId),
    name: raw.ownerName,
    email: raw.ownerEmail,
    sourceRefs: [{ source: SOURCE, externalId: raw.ownerId }],
  };
}

function toWorkItem(raw: RawSalesforceRecord): WorkItem {
  return {
    id: canonicalId(raw.id),
    source: SOURCE,
    externalId: raw.id,
    title: raw.name,
    status: raw.stageName,
    isDone: raw.isClosed,
    assignee: toPerson(raw),
    parent: raw.accountId && raw.accountName ? { id: canonicalId(raw.accountId), title: raw.accountName } : null,
    scope: raw.description ?? null,
    team: raw.department ?? null,
    url: raw.url,
    dueDateMs: raw.closeDateMs,
    createdMs: raw.createdDateMs,
    closedMs: raw.closedDateMs,
    updatedMs: raw.lastModifiedDateMs,
    lastActivityNote: raw.lastActivityNote ?? null,
  };
}

/**
 * Fixture-backed for now — see lib/connectors/salesforce/fixtures.ts and the
 * same note in the ClickUp adapter. Note how little this file has in common
 * with clickup/adapter.ts beyond the shape it maps *into*: that's the point.
 */
export const salesforceConnector: Connector = {
  source: SOURCE,
  displayName: "Salesforce",

  async listPeople(): Promise<Person[]> {
    const byId = new Map<string, Person>();
    for (const record of rawSalesforceRecords) {
      if (!byId.has(record.ownerId)) byId.set(record.ownerId, toPerson(record));
    }
    return Array.from(byId.values());
  },

  async listWorkItems(): Promise<WorkItem[]> {
    return rawSalesforceRecords.map(toWorkItem);
  },

  async listDependencyEdges(): Promise<DependencyEdge[]> {
    const edges: DependencyEdge[] = [];
    for (const record of rawSalesforceRecords) {
      for (const blockedExternalId of record.blockingIds ?? []) {
        edges.push({
          blockerId: canonicalId(record.id),
          blockedId: canonicalId(blockedExternalId),
          confidence: "confirmed",
        });
      }
    }
    return edges;
  },
};
