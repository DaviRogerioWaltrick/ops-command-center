import "server-only";
import type { DependencyEdge, Person, WorkItem } from "../types";

/**
 * The one interface every data source implements. A new source (HubSpot,
 * Monday.com, Jira, whatever the next venture actually runs on) is a new
 * adapter satisfying this contract — nothing in lib/rules, lib/ranking, or
 * app/ ever imports a source-specific type.
 */
export interface Connector {
  readonly source: string;
  readonly displayName: string;
  listPeople(): Promise<Person[]>;
  listWorkItems(): Promise<WorkItem[]>;
  /**
   * Explicit blocks/blocked-by or related-record links this source's own API
   * states directly. Ground truth only — a connector must never guess here.
   * AI-inferred edges are computed later, centrally, in
   * lib/rules/dependencies.ts, so every source gets the same inference
   * treatment instead of each adapter reinventing it.
   */
  listDependencyEdges(): Promise<DependencyEdge[]>;
}
