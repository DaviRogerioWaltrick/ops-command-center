/**
 * Sample data shaped like a trimmed-down ClickUp task payload. Stands in for
 * a live ClickUp pull until a real workspace is connected (see
 * lib/rules/sequencing note in README — subscriptions/live credentials are
 * gated behind the development-phase go-ahead). Swapping this fixture module
 * for a real `clickupFetch` call is the only change adapter.ts needs later.
 */

export interface RawClickUpTask {
  id: string;
  name: string;
  status: string;
  isDoneStatus: boolean;
  assignee: { id: string; name: string; email: string } | null;
  parentId?: string | null;
  parentName?: string | null;
  description?: string | null;
  team?: string | null;
  url: string;
  dueDateMs: number | null;
  createdMs: number | null;
  closedMs: number | null;
  updatedMs: number | null;
  lastComment?: string | null;
  /** Ids of other tasks that cannot start/finish until this one is done — ClickUp's own task-relationship data. */
  blocks?: string[];
}

const DAY_MS = 86_400_000;
const now = Date.now();

export const rawClickUpTasks: RawClickUpTask[] = [
  {
    id: "cu-101",
    name: "Finalize onboarding checklist template",
    status: "in progress",
    isDoneStatus: false,
    assignee: { id: "cu-p-1", name: "Jordan Ruiz", email: "jordan@example.com" },
    parentId: "cu-proj-1",
    parentName: "Client Onboarding Revamp",
    description: "Done when the checklist covers kickoff through first-deliverable handoff and is reviewed by ops.",
    team: "Operations",
    url: "https://app.clickup.com/t/cu-101",
    dueDateMs: now - 3 * DAY_MS,
    createdMs: now - 20 * DAY_MS,
    closedMs: null,
    updatedMs: now - 4 * DAY_MS,
    lastComment: "Still waiting on legal's sign-off on the liability section.",
    blocks: ["cu-102", "cu-103"],
  },
  {
    id: "cu-102",
    name: "Train CS team on new onboarding checklist",
    status: "open",
    isDoneStatus: false,
    assignee: { id: "cu-p-2", name: "Priya Nair", email: "priya@example.com" },
    parentId: "cu-proj-1",
    parentName: "Client Onboarding Revamp",
    description: "Done when every CS rep has run through the checklist once with a mock client.",
    team: "Client Success",
    url: "https://app.clickup.com/t/cu-102",
    dueDateMs: now + 5 * DAY_MS,
    createdMs: now - 18 * DAY_MS,
    closedMs: null,
    updatedMs: now - 10 * DAY_MS,
    lastComment: null,
  },
  {
    id: "cu-103",
    name: "Publish onboarding SOP to team wiki",
    status: "open",
    isDoneStatus: false,
    assignee: { id: "cu-p-2", name: "Priya Nair", email: "priya@example.com" },
    parentId: "cu-proj-1",
    parentName: "Client Onboarding Revamp",
    description: null,
    team: "Client Success",
    url: "https://app.clickup.com/t/cu-103",
    dueDateMs: now + 12 * DAY_MS,
    createdMs: now - 18 * DAY_MS,
    closedMs: null,
    updatedMs: now - 18 * DAY_MS,
    lastComment: null,
  },
  {
    id: "cu-104",
    name: "Fix invoice export bug for Enterprise plan",
    status: "in progress",
    isDoneStatus: false,
    assignee: { id: "cu-p-3", name: "Marcus Lee", email: "marcus@example.com" },
    parentId: "cu-proj-2",
    parentName: "Billing Reliability",
    description: "Done when Enterprise invoices export with correct line-item totals in CSV and PDF.",
    team: "Engineering",
    url: "https://app.clickup.com/t/cu-104",
    dueDateMs: now - 10 * DAY_MS,
    createdMs: now - 25 * DAY_MS,
    closedMs: null,
    updatedMs: now - 1 * DAY_MS,
    lastComment: "Root cause found, PR up for review — should close by EOD.",
  },
  {
    id: "cu-105",
    name: "Notify Enterprise clients about invoice fix",
    status: "open",
    isDoneStatus: false,
    assignee: { id: "cu-p-4", name: "Sana Bhatt", email: "sana@example.com" },
    parentId: "cu-proj-2",
    parentName: "Billing Reliability",
    description: null,
    team: "Client Success",
    url: "https://app.clickup.com/t/cu-105",
    dueDateMs: now + 3 * DAY_MS,
    createdMs: now - 9 * DAY_MS,
    closedMs: null,
    updatedMs: now - 9 * DAY_MS,
    lastComment: null,
  },
  {
    id: "cu-106",
    name: "Weekly ops metrics recap",
    status: "on hold",
    isDoneStatus: false,
    assignee: { id: "cu-p-1", name: "Jordan Ruiz", email: "jordan@example.com" },
    parentId: null,
    parentName: null,
    description: null,
    team: "Operations",
    url: "https://app.clickup.com/t/cu-106",
    dueDateMs: now - 1 * DAY_MS,
    createdMs: now - 40 * DAY_MS,
    closedMs: null,
    updatedMs: now - 22 * DAY_MS,
    lastComment: "Paused pending the new dashboard — see other thread.",
  },
  // The cross-source case: nothing in ClickUp's own data links these two
  // tasks to Salesforce's "MSA redline approval — Northwind Logistics"
  // (sf-201) — that's not a field ClickUp has. The only way to find this
  // dependency at all is inferDependencyEdges reading this task's own text
  // alongside the Salesforce item's, across the merged cross-connector set.
  // See COMPETITIVE_ANALYSIS.md, "Cross-source dependency detection".
  {
    id: "cu-107",
    name: "Provision Northwind's production environment",
    status: "open",
    isDoneStatus: false,
    assignee: { id: "cu-p-3", name: "Marcus Lee", email: "marcus@example.com" },
    parentId: "cu-proj-3",
    parentName: "Northwind Logistics Onboarding",
    description: "Done when the production environment is live and handed off to Northwind's admin.",
    team: "Engineering",
    url: "https://app.clickup.com/t/cu-107",
    dueDateMs: now + 7 * DAY_MS,
    createdMs: now - 15 * DAY_MS,
    closedMs: null,
    updatedMs: now - 15 * DAY_MS,
    lastComment: "Can't provision anything until Legal has a signed MSA — sales says it's still stuck in redlines.",
  },
  {
    id: "cu-108",
    name: "Schedule Northwind kickoff call",
    status: "open",
    isDoneStatus: false,
    assignee: { id: "cu-p-4", name: "Sana Bhatt", email: "sana@example.com" },
    parentId: "cu-proj-3",
    parentName: "Northwind Logistics Onboarding",
    description: null,
    team: "Client Success",
    url: "https://app.clickup.com/t/cu-108",
    dueDateMs: now + 10 * DAY_MS,
    createdMs: now - 15 * DAY_MS,
    closedMs: null,
    updatedMs: now - 15 * DAY_MS,
    lastComment: "Holding off booking a date with the client until the MSA is actually signed.",
  },
];
