/**
 * Sample data shaped like a trimmed-down Salesforce Opportunity/Case record.
 * Deliberately uses Salesforce's own vocabulary (StageName, OwnerId,
 * IsClosed, AccountName) rather than ClickUp's, so mapping both into the
 * same canonical WorkItem in adapter.ts actually proves the abstraction
 * generalizes instead of secretly assuming ClickUp's shape everywhere.
 */

export interface RawSalesforceRecord {
  id: string;
  name: string;
  stageName: string;
  isClosed: boolean;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  accountId?: string | null;
  accountName?: string | null;
  description?: string | null;
  department?: string | null;
  url: string;
  closeDateMs: number | null;
  createdDateMs: number | null;
  closedDateMs: number | null;
  lastModifiedDateMs: number | null;
  lastActivityNote?: string | null;
  /** Ids of other records that must close first — Salesforce's own related-record links. */
  blockingIds?: string[];
}

const DAY_MS = 86_400_000;
const now = Date.now();

export const rawSalesforceRecords: RawSalesforceRecord[] = [
  {
    id: "sf-201",
    name: "MSA redline approval — Northwind Logistics",
    stageName: "Negotiation",
    isClosed: false,
    ownerId: "sf-p-1",
    ownerName: "Elena Vance",
    ownerEmail: "elena@example.com",
    accountId: "sf-acct-1",
    accountName: "Northwind Logistics",
    description: "Done when legal countersigns the redlined MSA and it's logged in the deal room.",
    department: "Legal",
    url: "https://example.my.salesforce.com/sf-201",
    closeDateMs: now - 6 * DAY_MS,
    createdDateMs: now - 30 * DAY_MS,
    closedDateMs: null,
    lastModifiedDateMs: now - 2 * DAY_MS,
    lastActivityNote: "Client's counsel asked for one more revision on the indemnity clause.",
    // No blockingIds here on purpose. The real downstream work this blocks
    // (see cu-107/cu-108 in the ClickUp fixtures) lives in a different
    // connector — Salesforce's own API has no way to know that, and neither
    // does any single-source "confirmed" edge. This is deliberately the
    // fixture for the cross-source case: it can only ever be found by
    // inferDependencyEdges reading across the merged item set, never as a
    // confirmed DependencyEdge. See COMPETITIVE_ANALYSIS.md.
  },
  {
    id: "sf-204",
    name: "Renewal outreach — Torrance Retail Group",
    stageName: "Prospecting",
    isClosed: false,
    ownerId: "sf-p-1",
    ownerName: "Elena Vance",
    ownerEmail: "elena@example.com",
    accountId: "sf-acct-2",
    accountName: "Torrance Retail Group",
    description: "Done when a renewal call is booked before the contract's 30-day notice window closes.",
    department: "Sales",
    url: "https://example.my.salesforce.com/sf-204",
    closeDateMs: now - 2 * DAY_MS,
    createdDateMs: now - 12 * DAY_MS,
    closedDateMs: null,
    lastModifiedDateMs: now - 12 * DAY_MS,
    lastActivityNote: null,
  },
];
