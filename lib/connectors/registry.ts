import "server-only";
import type { Connector } from "./types";
import type { DependencyEdge, Person, WorkItem } from "../types";
import { clickUpConnector } from "./clickup/adapter";
import { linearConnector } from "./linear/adapter";
import { salesforceConnector } from "./salesforce/adapter";

/**
 * Every connected source. Adding a new one (HubSpot, Monday.com, Jira, ...)
 * means writing an adapter that satisfies Connector and pushing it into this
 * array — nothing else in the app changes.
 */
export const connectors: Connector[] = [clickUpConnector, salesforceConnector, linearConnector];

export interface AggregatedData {
  people: Person[];
  workItems: WorkItem[];
  dependencyEdges: DependencyEdge[];
}

/**
 * Merges a person seen in two sources under the same email into one
 * canonical identity (keeping the first-seen id, unioning sourceRefs) — a
 * team lead who's both a ClickUp assignee and a Salesforce owner should read
 * as one person's workload, not two half-sized ones.
 */
function mergePeople(people: Person[]): Person[] {
  const byEmail = new Map<string, Person>();
  const noEmail: Person[] = [];

  for (const person of people) {
    if (!person.email) {
      noEmail.push(person);
      continue;
    }
    const existing = byEmail.get(person.email);
    if (existing) {
      existing.sourceRefs.push(...person.sourceRefs);
    } else {
      byEmail.set(person.email, { ...person, sourceRefs: [...person.sourceRefs] });
    }
  }

  return [...byEmail.values(), ...noEmail];
}

/**
 * A work item's assignee is built per source, so after mergePeople it still
 * carries the per-source id while the merged Person list carries the first
 * source's id. Point each item at its canonical merged person; otherwise
 * anything matching on `assignee.id` (workload, releasesWorkFor) only sees
 * the items from whichever source happened to be listed first.
 */
function reassignToMergedPeople(workItems: WorkItem[], people: Person[]): WorkItem[] {
  const canonicalBySourceId = new Map<string, Person>();
  for (const person of people) {
    for (const ref of person.sourceRefs) canonicalBySourceId.set(`${ref.source}:${ref.externalId}`, person);
  }
  return workItems.map((item) => {
    const merged = item.assignee ? canonicalBySourceId.get(item.assignee.id) : undefined;
    return merged && merged !== item.assignee ? { ...item, assignee: merged } : item;
  });
}

/** Pulls from every connected source in parallel and merges into one canonical dataset. */
export async function getAggregatedData(): Promise<AggregatedData> {
  const results = await Promise.all(
    connectors.map(async (connector) => ({
      people: await connector.listPeople(),
      workItems: await connector.listWorkItems(),
      dependencyEdges: await connector.listDependencyEdges(),
    })),
  );

  const people = mergePeople(results.flatMap((r) => r.people));
  return {
    people,
    workItems: reassignToMergedPeople(
      results.flatMap((r) => r.workItems),
      people,
    ),
    dependencyEdges: results.flatMap((r) => r.dependencyEdges),
  };
}
