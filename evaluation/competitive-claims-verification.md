# Verification of COMPETITIVE_ANALYSIS.md claims

Retrieved Oct 5, 2026. Purpose: check each factual claim against the vendors' own documentation before the analysis is rewritten for the public repo.

**Method and limits (read first).** Evidence comes from web-search result summaries and from a summarising page fetch (a small model reads the page and answers a question), not from reading every page in full. monday.com's support site returned HTTP 403 to the fetcher, so monday claims rest on search summaries only. Absence claims ("no vendor has X") cannot be proven from documentation; at best they can be reported as "not found in the pages checked, as of the retrieval date". A verdict of "Confirmed" means the cited page, as summarised, supports the claim; it is not a guarantee about the full product.

Verdicts: **Confirmed**, **Corrected** (the claim as written is wrong or overstated), **Not found** (searched, no support), **Not verified** (not checked or could not be read).

## Headline claims

| # | Claim in the analysis | Verdict | What the documentation says | Source |
|---|---|---|---|---|
| H1 | monday.com has 30+ widget types | Confirmed | "Over 30 widgets"; a dashboard holds up to 30 widgets. | support.monday.com/hc/en-us/articles/360002187819-The-Dashboards |
| H2 | monday.com has native multi-board aggregation on every plan tier, including Free | **Corrected** | Boards per dashboard depend on plan: Free 1, Standard 5, Pro 20, Enterprise 50; at most 20,000 items across the connected boards. Free does not aggregate across boards. | same page |
| H3 | Salesforce and HubSpot have mature cross-object report builders | Confirmed | Salesforce: custom report types and joined reports (up to five blocks). HubSpot: custom report builder with multi-object joins. | help.salesforce.com (joined reports: reports_joined_format_concepts); knowledge.hubspot.com/reports/create-custom-single-object-reports |
| H4 | Asana dashboards are configurable within a fixed chart palette | Confirmed (reword) | A fixed set of chart types (column, line, burn-up, donut, number, lollipop; portfolio dashboards add bar variants), with configurable inputs, filters and grouping. "Palette" should read "set of chart types". | help.asana.com/s/article/chart-styles |

## Gap 1: cross-domain ranking

| # | Claim | Verdict | What the documentation says | Source |
|---|---|---|---|---|
| G1a | Salesforce Einstein scores opportunities | Confirmed | Einstein scores leads and opportunities (opportunity score 1 to 99, likelihood to be won). | help.salesforce.com (Sales Cloud Einstein Scoring) |
| G1b | HubSpot deal scores score deals | Confirmed | Deal scores predict the probability of winning open deals. | knowledge.hubspot.com/records/use-deal-scores |
| G1c | monday has "one prioritization agent" that scores bugs | **Corrected** | A Bug Prioritization Agent exists (sets severity, urgency and a resolution deadline). monday also describes agents that "triage, route, escalate, and prioritize work" by rules the user defines, so "one" understates it. | support.monday.com/hc/en-us/articles/33347027353746-AI-Agents-on-monday-com; monday.com/blog/ai-agents/ai-use-cases/ |
| G1d | Asana's own AI page says it "does not describe any features for ranking or prioritizing tasks based on reasoning about time, resources, or scope" | **Not found: remove the quote** | The sentence is not on Asana's AI help page or product page. It reads like a research summary, not Asana's words. Asana's pages do describe prioritization: an AI task list ordered by what is due, blocking someone or sitting too long, and AI Studio that prioritizes requests by goal alignment and capacity. | help.asana.com/s/article/get-started-with-asana-ai; asana.com/product/ai; asana.com/uses/ai-task-management |
| G1e | Nothing in the four ranks a mixed list of tasks, tickets, deals and opportunities on one axis | Not verified (absence) | Each scoring feature found is scoped to its own product's records, but absence cannot be proven. Report as "not found in the pages checked". | n/a |

## Gap 2: human-feedback loop on AI output

| # | Claim | Verdict | What the documentation says | Source |
|---|---|---|---|---|
| G2a | HubSpot deal scores show factor explanations | Confirmed | "Key factors": the top five factors with a plus or minus icon (Sales Hub or Smart CRM Professional/Enterprise; needs a Sales Seat). | knowledge.hubspot.com/records/use-deal-scores |
| G2b | Agentforce has human-in-the-loop approval checkpoints as a general pattern | Confirmed (in substance) | Guardrails that require human sign-off on high-stakes decisions and escalation that pauses the agent and routes to a person. | architect.salesforce.com/fundamentals/agentic-patterns |
| G2c | None of the four has a documented way to capture disagreement with a specific AI judgment | Partly verified | HubSpot's deal score page describes no feedback or dispute mechanism for an individual score. Salesforce, Asana and monday were not checked for this. | knowledge.hubspot.com/records/use-deal-scores |

## Gap 3: cost of delay

| # | Claim | Verdict | What the documentation says | Source |
|---|---|---|---|---|
| G3a | Asana cost tracking is a $5.99/user/month add-on | Confirmed (add detail) | Timesheets & Budgets add-on, $5.99 per user per month when billed annually; available on Starter, Advanced, Enterprise and Enterprise+; licensed per user. | asana.com/features/resource-management/timesheets-budgets |
| G3b | monday cost tracking is fully manual formula columns | Confirmed (in substance) | Budgets are tracked with Numbers and Formula columns; the Formula column is available on Pro and Enterprise only. | support.monday.com/hc/en-us/articles/115005311969-Manage-your-budget-with-monday-com; .../360001235445-The-Formula-Column |
| G3c | Salesforce has no cost tracking in Sales Cloud, only in the unrelated Field Service product | Not verified | Field Service has expense fields and work order estimation. Sales Cloud was not searched. | help.salesforce.com (Expense Fields for Field Service) |
| G3d | HubSpot has revenue and margin only, no labor-effort cost | Partly verified | Line items carry unit price and unit cost, with automatic margin. That absence of labor-effort cost was not tested. | knowledge.hubspot.com/properties/hubspots-default-line-item-properties |
| G3e | No cost-of-delay concept in any of the four | Not verified (absence) | Not tested. | n/a |

## Gap 4: workload

| # | Claim | Verdict | What the documentation says | Source |
|---|---|---|---|---|
| G4a | Salesforce and HubSpot have no native rep/team workload view at all | **Corrected** | Salesforce Omni Supervisor shows each service rep's workload against capacity. HubSpot's help desk shows each user's assigned tickets against capacity. Both are service-routing views; no sales or task workload view was found, but "at all" is wrong. | help.salesforce.com (omnichannel_supervisor_agents_tab); knowledge.hubspot.com/help-desk/route-tickets-in-help-desk |
| G4b | Asana Workload defaults to manual hours/points or task counts | Confirmed | Workload can measure task count, hours or points. | help.asana.com/s/article/portfolio-workload-and-universal-workload (via search summary) |
| G4c | Real logged time feeds Asana Workload only on Advanced+ | Confirmed (in substance) | Time tracking is on Advanced, Enterprise and Enterprise+; time-tracking data integrates with workload views. Workload: Advanced (Portfolio Workload), Enterprise and Enterprise+. The article itself could not be read in full. | asana.com/features/resource-management/time-tracking; asana.com/features/resource-management/workload |
| G4d | monday Workload defaults to item counts or manual Effort; the Time Tracking column does not feed it | Partly verified | Confirmed: Workload measures "Count item" or "Effort" from a Time Estimation, Number or Formula column. **Not verified:** whether the Time Tracking column feeds Workload (support page returned 403). | support.monday.com/hc/en-us/articles/360010699760-The-Workload-Widget (search summary only) |

## Gap 5: blending task and CRM data

| # | Claim | Verdict | What the documentation says | Source |
|---|---|---|---|---|
| G5a | Asana connects to Salesforce only through a narrow single-metric Goal link | Confirmed | A goal can be linked to a Salesforce report; progress updates from that report (Advanced+; report must be in a Public folder). | asana.com/apps/salesforce; help.asana.com/s/article/salesforce-in-asana-rules |
| G5b | monday syncs with Salesforce only through a paid, Enterprise-gated sync | Confirmed, with detail | Two-way sync app; needs monday Enterprise, is a paid add-on, and needs Salesforce Enterprise or Unlimited; polls every 3 minutes; supports all non-deprecated standard and custom objects. So it is broad, not narrow. | support.monday.com/hc/en-us/articles/31309659658642-Salesforce-Two-way-sync-app |
| G5c | HubSpot's data-sync list does not include ClickUp, Asana or Linear | **Not confirmed** | The data-sync article names no project-management tools (it names monday.com among spreadsheet-type apps) and links to the marketplace for the list, which was not fully read. HubSpot also has a native Asana integration (create Asana tasks from workflows), a Linear connector for its AI agents, and ClickUp apps; those are action integrations, not proof of reporting sync. | knowledge.hubspot.com/integrations/connect-and-use-hubspot-data-sync; ecosystem.hubspot.com/marketplace/apps/connector |
| G5d | Salesforce cannot pull ClickUp, Asana or Linear execution data for reporting | Not verified | Not searched. | n/a |

## The structural claim and vendor notes

| # | Claim | Verdict | Note |
|---|---|---|---|
| S1 | Cross-source dependency detection is something "no single vendor could ever ship, because it requires visibility into a competitor's data model" | Argument, not a documented fact | Reasoning about the market. It cannot be confirmed from documentation, and HubSpot's Linear connector and Asana integration show vendors do connect to each other. Present it as opinion, or drop "ever". |
| V1 | HubSpot flags stalled deals against the deal owner's own historical average per stage | Confirmed, with correction | Stalled means time in the current stage is at least 20% longer than the average for that stage across the owner's closed-won deals. Properties: "Is stalled after timestamp", "Average deal owner duration in current stage". Source: knowledge.hubspot.com/properties/hubspots-default-deal-properties (via search summary). |
| V2 | Asana real time tracking needs Advanced+, cost needs the Timesheets & Budgets add-on | Confirmed | See G3a and G4c. |
| V3 | Salesforce has the least native coverage on workload and dependencies | Partly contradicted | Omni Supervisor workload exists for service (see G4a). Dependencies were not tested. |

## Summary

- Confirmed: H1, H3, H4 (reword), G1a, G1b, G2a, G2b, G3a, G3b, G4b, G4c, G5a, G5b (with detail), V1 (with correction), V2.
- Corrected: H2 (monday Free plan), G1c (monday agents), G1d (Asana quote not found), G4a (Salesforce and HubSpot do have workload views, for service).
- Partly verified: G2c, G3d, G4d.
- Not confirmed or not verified: G1e, G3c, G3e, G4d (Time Tracking), G5c, G5d, S1 (opinion), V3.
