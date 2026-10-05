# Competitive analysis: what the major tools already do, and where this project adds something

**As of October 5, 2026.** Vendor products change quickly, so every claim below carries a source and should be re-checked before you rely on it.

## Scope and method

This looks at four widely used products: two task and project tools (Asana, monday.com) and two CRMs (Salesforce, HubSpot). The aim is practical: find out what is already solved natively, so this project does not rebuild it.

- Evidence comes from each vendor's own documentation, read through web-search summaries and a summarising page fetch, not a full read of every page.
- monday.com's support site could not be fetched directly, so monday claims rest on search summaries only.
- "Not found" means we looked in the pages named and did not see it. It does not mean the feature does not exist. Documentation alone cannot prove a feature is absent.
- Claims we could not check are listed under "Not verified" near the end, and are left out of the argument.

## Summary

All four products already have capable native reporting. Building another chart layer on top of any of them would duplicate what they do. The openings we found are narrower: ranking work across tools on one axis, capturing a person's disagreement with a specific AI judgement, and finding dependencies between a task tool and a CRM. The last is the one this project builds deliberately.

## What the four tools already do

| Area | What we found | Source |
|---|---|---|
| Dashboards across boards (monday.com) | More than 30 widget types. Boards per dashboard depend on plan: Free 1, Standard 5, Pro 20, Enterprise 50, with at most 20,000 items across them. | [monday dashboards](https://support.monday.com/hc/en-us/articles/360002187819-The-Dashboards) |
| Dashboards (Asana) | A fixed set of chart types (column, line, burn-up, donut, number, lollipop, plus bar variants on portfolio dashboards), configurable by input, filter and grouping. | [Asana chart styles](https://help.asana.com/s/article/chart-styles) |
| Cross-object reports (Salesforce, HubSpot) | Salesforce: custom report types and joined reports of up to five blocks. HubSpot: a custom report builder with multi-object joins. | [Salesforce joined reports](https://help.salesforce.com/s/articleView?language=en_US&id=analytics.reports_joined_format_concepts.htm&type=5), [HubSpot custom reports](https://knowledge.hubspot.com/reports/create-custom-single-object-reports) |
| Scoring inside one product | Salesforce Einstein scores leads and opportunities. HubSpot deal scores predict the chance of winning open deals and show the top five "key factors" with a plus or minus. | [Salesforce Einstein scoring](https://help.salesforce.com/s/articleView?id=ai.einstein_sales_scoring_parent.htm&language=en_US&type=5), [HubSpot deal scores](https://knowledge.hubspot.com/records/use-deal-scores) |
| AI prioritization inside one product | monday.com has a Bug Prioritization Agent and describes agents that triage, route, escalate and prioritize by rules the user sets. Asana describes an AI task list ordered by what is due, blocking someone or sitting too long, and AI Studio that prioritizes requests by goal alignment and capacity. | [monday AI agents](https://support.monday.com/hc/en-us/articles/33347027353746-AI-Agents-on-monday-com), [Asana AI task management](https://asana.com/uses/ai-task-management) |
| Human sign-off on AI actions | Salesforce's Agentforce guidance describes guardrails that require human sign-off on high-stakes decisions and escalation to a person. | [Agentforce patterns](https://architect.salesforce.com/fundamentals/agentic-patterns) |
| Stalled deal detection (HubSpot) | A deal is stalled when its time in the current stage is at least 20% longer than the deal owner's average for closed-won deals in that stage. | [HubSpot deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties) |
| Workload | Asana Workload measures task count, hours or points, and time-tracking data feeds it on Advanced and above. monday's Workload widget measures item count or "Effort" from a time-estimate, number or formula column. Salesforce (Omni Supervisor) and HubSpot (help desk) show service reps' assigned work against capacity. | [Asana time tracking](https://asana.com/features/resource-management/time-tracking), [Asana workload](https://asana.com/features/resource-management/workload), [monday Workload](https://support.monday.com/hc/en-us/articles/360010699760-The-Workload-Widget), [Salesforce Omni Supervisor](https://help.salesforce.com/s/articleView?id=sf.omnichannel_supervisor_agents_tab.htm&language=en_US&type=5), [HubSpot help desk](https://knowledge.hubspot.com/help-desk/route-tickets-in-help-desk) |
| Cost tracking | Asana: a Timesheets & Budgets add-on at $5.99 per user per month billed annually. monday.com: Numbers and Formula columns (Formula needs Pro or Enterprise). HubSpot: unit cost and automatic margin on line items. Salesforce Field Service: expense fields and work order estimation. | [Asana add-on](https://asana.com/features/resource-management/timesheets-budgets), [monday budgets](https://support.monday.com/hc/en-us/articles/115005311969-Manage-your-budget-with-monday-com), [HubSpot line items](https://knowledge.hubspot.com/properties/hubspots-default-line-item-properties), [Salesforce expenses](https://help.salesforce.com/s/articleView?id=sf.fs_expense_fields.htm&language=en_US&type=5) |
| Task tool to CRM | Asana can link a goal to a Salesforce report (Advanced and above; the report must be in a public folder). monday.com offers a two-way Salesforce sync on its Enterprise plan as a paid add-on, covering all non-deprecated Salesforce objects. | [Asana and Salesforce](https://asana.com/apps/salesforce), [monday two-way sync](https://support.monday.com/hc/en-us/articles/31309659658642-Salesforce-Two-way-sync-app) |

## Where this project adds something

These are the areas where we did not find a native feature in the pages above. Treat each as "not found as of the date above", not as a proven absence.

1. **Ranking across tools on one axis.** Every scoring or prioritization feature we found works on that product's own records (deals, opportunities, bugs, tasks). We did not find one that ranks a mixed list of tasks, tickets and deals against each other.
2. **A way to record disagreement with one specific AI judgement.** HubSpot's deal score page shows key factors but describes no way to give feedback on or dispute an individual score. We did not check the other three products for this.
3. **Cost of delay.** We found cost and budget features (see the table) but did not find one that computes what a delay is costing. We did not search exhaustively.
4. **Workload from tracked time as the default.** The workload views we found default to counts or estimates, and tracked time feeds Asana's view only on higher plans. Whether monday's Time Tracking column feeds its Workload widget is not verified.
5. **Task and CRM data in one analytical view.** The task-to-CRM links we found are a single-metric goal link (Asana) and a paid, Enterprise-gated sync (monday.com). Whether HubSpot or Salesforce can bring in ClickUp, Asana or Linear execution data for reporting is not verified.

## Cross-source dependency detection (the design bet)

The capability this project builds on purpose is: "finishing this task in the task tool releases a stalled deal in the CRM." This is an argument about the market, not a documented fact: a vendor's own tool sees its own records, and a link between two vendors' systems has no native origin in either, so it can only be inferred from text or declared by a person. Vendors do connect to each other (for example HubSpot has a Linear connector and an Asana integration), but those connections act on records; we found none that detects a dependency across systems.

How the code supports this:
- Item ids are namespaced by source (for example `clickup:cu-101`, `salesforce:sf-202`), so a link between two sources is structurally valid.
- `inferDependencyEdges` in `lib/dependencies.ts` reads the full merged set of items from every connector, so it can spot a likely cross-source relationship from the text.
- An inferred link is kept separate from confirmed links and shown as lower confidence. A person can promote one to confirmed (`lib/dependency-overrides.ts`), after which it counts everywhere as a real dependency.

## Notes if you use one of these tools

- **HubSpot:** stalled-deal detection already exists for deals. Extending the same idea to tasks and tickets in one cross-object view is more useful than rebuilding it for deals.
- **monday.com:** its dashboards are strong, so competing on charts is wasted effort. Read its data and put the effort into ranking, reasoning and feedback. Check which plan you are on, because boards per dashboard and the Salesforce sync depend on it.
- **Asana:** check licensing before relying on tracked time or cost. Time tracking needs Advanced or above, and cost tracking needs the separate add-on.
- **Salesforce:** we found workload views for service reps and cost features in Field Service. We did not check Sales Cloud for cost, and did not test dependencies.

## What this means for the design

- **Keep:** the connector-agnostic canonical model, the split between confirmed and inferred dependencies, the AI ranking with a rule-based fallback, and the rule never to invent a number the source data does not support (see `MANIFESTO.md`).
- **Put the effort into:** cross-tool ranking, the feedback loop on individual judgements, and cross-source dependencies.
- **Do not spend effort on:** general charting or BI widgets, per-record AI summaries, or basic dependency-link recording. All four products already cover these.

## Not verified

- Whether monday's Time Tracking column feeds its Workload widget (the support page could not be fetched).
- Whether HubSpot's data sync or marketplace can bring ClickUp, Asana or Linear data into reports, and whether Salesforce can.
- Whether Salesforce Sales Cloud has cost tracking.
- Whether any of the four has a cost-of-delay feature, and whether Salesforce, Asana or monday.com offer a way to give feedback on an individual AI score.
- Anything about pricing or plan limits after the retrieval date.
