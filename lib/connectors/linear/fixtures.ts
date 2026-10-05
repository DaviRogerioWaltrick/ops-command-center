/**
 * Sample data shaped like a trimmed-down Linear issue, in the structure
 * Linear's GraphQL API returns it. Chosen deliberately to differ from ClickUp
 * and Salesforce in two ways that stress the canonical model:
 *
 * 1. Dependencies arrive in the INVERSE direction: each issue lists the
 *    relations that point AT it (`inverseRelations`), where the ClickUp and
 *    Salesforce fixtures list the issues a record blocks. Linear's own docs
 *    show both "Blocked by" and "Blocks" on an issue sidebar as inverse pairs
 *    (linear.app/docs/issue-relations).
 * 2. Status is a category (`state.type`), not a done/not-done flag, and two
 *    of its values (canceled, duplicate) close an issue without delivering it.
 *
 * Shape checked Oct 2, 2026 against Linear's public GraphQL schema
 * (github.com/linear/linear, packages/sdk/src/schema.graphql), and reshaped to
 * match on Oct 4, 2026:
 * - `Issue.state` is `{ name, type }`; `type` is a string: "triage",
 *   "backlog", "unstarted", "started", "completed", "canceled" or "duplicate".
 * - `Issue.project` is `{ id, name }` and `Issue.team` is `{ id, name }`.
 * - Dependencies are `IssueRelation` records (`type`: "blocks", "duplicate",
 *   "related" or "similar"; `issue`; `relatedIssue`). "A blocks B" is a
 *   relation with issue A, relatedIssue B, type "blocks". It shows up on B as
 *   an `inverseRelations` node (`issue` is the blocker) and on A as a
 *   `relations` node. This fixture carries only `inverseRelations`, which is
 *   enough to build every edge when all issues are fetched.
 * - `Issue.comments` is a connection of `{ body, createdAt }`; the adapter
 *   takes the newest, so it does not depend on the API's ordering.
 * - `completedAt`, `canceledAt`, `dueDate`, `createdAt`, `updatedAt` exist as named.
 * Not verified: how the real API orders and paginates comments and relations
 * (both are connections that take first/after), whether the master-branch
 * schema file matches the deployed API, and what a "duplicate" issue's
 * timestamps look like. The fixture's values are invented.
 * Timestamps are ISO strings here (ClickUp and Salesforce fixtures use epoch
 * ms) so the adapter has to normalise a third format.
 */

export type LinearStateType = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled" | "duplicate";

export interface RawLinearIssue {
  id: string;
  title: string;
  description?: string | null;
  state: { name: string; type: LinearStateType };
  assignee: { id: string; name: string; email: string } | null;
  project?: { id: string; name: string } | null;
  team?: { name: string } | null;
  url: string;
  dueDate: string | null;
  createdAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  updatedAt: string | null;
  comments?: { nodes: { body: string; createdAt: string }[] };
  /** Relations that point at THIS issue. A "blocks" node's `issue` is a blocker, the inverse of the ClickUp/Salesforce `blocks` lists. */
  inverseRelations?: { nodes: { type: string; issue: { id: string } }[] };
}

const DAY_MS = 86_400_000;
const now = Date.now();
const iso = (offsetDays: number): string => new Date(now + offsetDays * DAY_MS).toISOString();

export const rawLinearIssues: RawLinearIssue[] = [
  {
    id: "lin-301",
    title: "Migrate auth service to the new token format",
    state: { name: "In Progress", type: "started" },
    assignee: { id: "lin-u-1", name: "Theo Brandt", email: "theo@example.com" },
    project: { id: "lin-proj-1", name: "Platform Hardening" },
    description: "Done when every service validates the new token format and the old format is rejected in staging.",
    team: { name: "Engineering" },
    url: "https://linear.app/example/issue/LIN-301",
    dueDate: iso(-2),
    createdAt: iso(-18),
    completedAt: null,
    canceledAt: null,
    updatedAt: iso(-1),
    comments: { nodes: [{ body: "Two services still accept the old format; fixing the validator now.", createdAt: iso(-1) }] },
  },
  {
    id: "lin-302",
    title: "Update mobile clients for the new token format",
    state: { name: "Todo", type: "unstarted" },
    assignee: { id: "lin-u-2", name: "Priya Nair", email: "priya@example.com" },
    project: { id: "lin-proj-1", name: "Platform Hardening" },
    description: "Done when iOS and Android builds authenticate against staging with the new token format.",
    team: { name: "Engineering" },
    url: "https://linear.app/example/issue/LIN-302",
    dueDate: iso(5),
    createdAt: iso(-17),
    completedAt: null,
    canceledAt: null,
    updatedAt: iso(-6),
    comments: { nodes: [] },
    inverseRelations: { nodes: [{ type: "blocks", issue: { id: "lin-301" } }] },
  },
  {
    id: "lin-303",
    title: "Load-test the new billing endpoint",
    state: { name: "Backlog", type: "backlog" },
    assignee: { id: "lin-u-3", name: "Sana Bhatt", email: "sana@example.com" },
    project: { id: "lin-proj-2", name: "Billing Rework" },
    description: "Done when the endpoint sustains the agreed request rate in staging with no error-rate regression.",
    team: { name: "Engineering" },
    url: "https://linear.app/example/issue/LIN-303",
    dueDate: iso(9),
    createdAt: iso(-12),
    completedAt: null,
    canceledAt: null,
    updatedAt: iso(-3),
    comments: { nodes: [] },
    inverseRelations: { nodes: [{ type: "blocks", issue: { id: "lin-304" } }] },
  },
  {
    id: "lin-304",
    title: "Provision the staging database for billing",
    state: { name: "In Review", type: "started" },
    assignee: { id: "lin-u-1", name: "Theo Brandt", email: "theo@example.com" },
    project: { id: "lin-proj-2", name: "Billing Rework" },
    description: "Done when the staging database mirrors production schema and is reachable from the load-test runner.",
    team: { name: "Engineering" },
    url: "https://linear.app/example/issue/LIN-304",
    dueDate: iso(-1),
    createdAt: iso(-10),
    completedAt: null,
    canceledAt: null,
    updatedAt: iso(-1),
    comments: { nodes: [{ body: "Waiting on a review of the access rules.", createdAt: iso(-1) }] },
  },
  {
    id: "lin-305",
    title: "Evaluate a self-hosted search service",
    state: { name: "Canceled", type: "canceled" },
    assignee: { id: "lin-u-3", name: "Sana Bhatt", email: "sana@example.com" },
    project: { id: "lin-proj-3", name: "Search Improvements" },
    description: "Done when a recommendation is written up with cost and operational trade-offs.",
    team: { name: "Engineering" },
    url: "https://linear.app/example/issue/LIN-305",
    dueDate: iso(-4),
    createdAt: iso(-25),
    completedAt: null,
    canceledAt: iso(-2),
    updatedAt: iso(-2),
    comments: { nodes: [{ body: "Dropped: the hosted option was approved instead, so no evaluation is needed.", createdAt: iso(-2) }] },
  },
  {
    id: "lin-306",
    title: "Ship the invoice export fix, second pass",
    state: { name: "Done", type: "completed" },
    assignee: { id: "lin-u-2", name: "Priya Nair", email: "priya@example.com" },
    project: { id: "lin-proj-3", name: "Search Improvements" },
    description: "Done when the export completes for accounts above 10,000 invoices.",
    team: { name: "Engineering" },
    url: "https://linear.app/example/issue/LIN-306",
    dueDate: iso(-5),
    createdAt: iso(-20),
    completedAt: iso(-3),
    canceledAt: null,
    updatedAt: iso(-3),
    comments: { nodes: [{ body: "Shipped and verified against the largest account.", createdAt: iso(-3) }] },
  },
  {
    id: "lin-307",
    title: "Notify clients of the search API deprecation",
    state: { name: "Todo", type: "unstarted" },
    assignee: { id: "lin-u-2", name: "Priya Nair", email: "priya@example.com" },
    project: { id: "lin-proj-3", name: "Search Improvements" },
    description: "Done when every affected client has received the deprecation notice and migration guide.",
    team: { name: "Engineering" },
    url: "https://linear.app/example/issue/LIN-307",
    dueDate: iso(3),
    createdAt: iso(-9),
    completedAt: null,
    canceledAt: null,
    updatedAt: iso(-4),
    comments: { nodes: [] },
    inverseRelations: { nodes: [{ type: "blocks", issue: { id: "lin-305" } }] },
  },
];
