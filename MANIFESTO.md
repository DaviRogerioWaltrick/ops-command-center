# The data manifesto

ops-command-center can only reason as well as the source system lets it. A clever ranking prompt cannot invent a time-tracking history a task tool never recorded. This document is the contract: what any connected task-management or CRM system must actually track for the dashboard to function as designed, and the rules the AI must follow when that data is partial or missing. Whatever tool you connect — ClickUp, Linear, Monday.com, Jira, something else — gets checked against this document, not the other way around.

## The governing principle: options, not verdicts

The AI does not decide what's true. It surfaces a reading of the evidence, states what it's uncertain about, and leaves the call to the operator. Concretely:

- A ranking is a hypothesis with a stated reason, not an assertion. When the evidence is genuinely ambiguous, the reasoning should say so and name the plausible alternatives, rather than picking one and asserting it confidently.
- Every ranking carries a real way to push back — agree, or say the rank should differ, with room for the operator's own reasoning in their own words (see `components/feedback-form.tsx`).
- That pushback is not a throwaway click. It's meant to accumulate — see "Closing the loop" below — so the next ranking run is informed by what the operator actually knows that the model didn't.
- Confirmed facts (a due date, a stated dependency, logged time) and inferred ones (an AI-guessed dependency, a suspected cause) are never shown with the same visual or textual certainty. This is already the standing rule for dependency edges (`lib/dependencies.ts`); it now extends to every dimension below.

## The three pillars

Time, resources, and scope — the framing used for how the AI should reason about priority. Each needs specific data the app cannot manufacture on its own.

### Time

| Needed | Why | Status |
|---|---|---|
| Due date | Baseline urgency | Have — `WorkItem.dueDateMs` |
| Status / completion state | Is it actually done | Have — `WorkItem.isDone` |
| **Time actually tracked**, per person, per task | Distinguishes "idle" from "slow-moving but active" — especially on in-progress and overdue items | New — `WorkItem.timeTrackedMs`, added to the canonical model, currently unpopulated by any adapter |
| **Task category/type** | Groups tasks into comparable buckets | New — `WorkItem.category` |
| **Historical duration for that category** | Lets the AI say "this has taken 12 hours; similar tasks usually take 6" instead of just "it's overdue" | Not a separate store — computed by comparing a task's `timeTrackedMs`/elapsed time against other *closed* items sharing the same `category`. Needs enough closed, categorized, time-tracked history to be meaningful; degrades to due-date-age heuristics until then. |

Without time tracking turned on in the source system, "how long is this really taking" collapses to "how long past its due date is this" — which is what the app already does, and all it can honestly do until real time data exists.

### Resources

| Needed | Why | Status |
|---|---|---|
| Cost rate (per person or per role) | Input to any cost figure | New — `Person.costRatePerHour`, optional, sensitive |
| Time tracked (see above) | The other input — rate × time = cost incurred | New |
| Budget or cost ceiling per task/initiative | Lets the app say "over budget," not just "cost so far" | Not yet modeled — add when a source exposes one |
| Tooling/resource dependencies | What licenses, contractors, or specialized capacity a task consumes | Not yet modeled — likely a tag/label on the task, source-dependent |

**Cost-of-delay is always a derived number, never a stored one.** It's computed from rate × time × who's waiting, not read off a field — because no task tool has a "cost of delay" column. This matters for honesty: any dollar figure in a design mock-up is only an illustrative placeholder for that computed slot, not a preview of real behavior. The real app shows a cost figure only when both a rate and tracked time exist for everyone involved; otherwise it says the cost isn't trackable yet, which is itself a useful signal — it means the source system doesn't have the data this decision needs.

**Governance note:** individual hourly rates are sensitive. The rule in both `lib/types.ts` and `lib/db/schema.ts` is that `costRatePerHour` is never rendered raw in any view — only consumed inside a computed aggregate (a total cost, a delta, a budget-burn percentage). If a view ever needs to show a raw rate, that's a deliberate decision to revisit here first, not an incidental leak.

### Scope

| Needed | Why | Status |
|---|---|---|
| Parent initiative/project | What this task is part of | Have — `WorkItem.parent` |
| Confirmed dependency links | Does finishing this release other work | Have — `DependencyEdge`, confirmed vs. inferred |
| Definition of done / scope text | What "complete" actually means for this item | Have — `WorkItem.scope`, but only useful if the team actually fills it in — an adoption requirement, not a technical one |
| Initiative-level completion (% of sibling tasks done) | Judges impact relative to how much of the larger goal this task represents | Not yet modeled — computable once enough sibling `WorkItem`s under the same `parent` are synced, no new field required |

## Workload is a time measure, not a count

The current "workload" axis (the scatter plot on the command view) uses open-item *count* as a stand-in for how much someone is carrying. That's a placeholder, not the target design — a person with three large tasks and a person with three quick ones do not carry the same load. Once time tracking exists, workload should be measured in tracked or estimated hours, with item count as the fallback only when a source has no time data at all. This is a known gap to close when the UI work resumes, not a new decision — flagging it here so it isn't mistaken for a finished design.

## A configuration checklist

Handed to whoever sets up the next task-management system, or used to evaluate whether an existing one is usable as-is:

1. **Time tracking is turned on**, and the team actually logs time against tasks — not just estimates.
2. **A standardized task category/type field** exists and is populated — a free-text title is not a taxonomy.
3. **Dependency/relationship links** are a native feature and get used (most modern tools — Linear, ClickUp, Monday.com, Jira — have some form of "blocks/blocked by"; it only helps if people actually link tasks instead of leaving it implicit in a comment).
4. **A definition-of-done or scope field** is filled in per task, not left blank.
5. **A parent initiative/project link** exists for every task that belongs to one.
6. If cost tracking is wanted: **a rate per person or role** is available somewhere (inside the tool or in a small reference table the dashboard can read), and **a budget field** exists at the task or initiative level.

A tool that fails most of these isn't disqualified — it just means the dashboard runs on Time-axis-only reasoning (the mode it's in today) until the gaps close.

## Closing the loop

Every ranking the operator reacts to — agree, or "rank should differ" plus their own reasoning — is meant to be kept, in `rankingFeedback` (`lib/db/schema.ts`), tied to the specific ranking it responds to. This is what making the options more sound as feedback accumulates actually requires: a persisted, growing record of the operator's own judgment that a future ranking run can be given as context, rather than a system that re-derives the same blind read every time. Like the rest of the persistence layer, this table is schema-only until the development phase starts — the requirement is recorded now so it isn't improvised later under time pressure.

## What this doesn't do

This manifesto sets a bar; it doesn't demand every field before anything ships. The application's standing design principle already follows the rule about verified facts: when a data point is missing, the app says so and falls back to a coarser signal — it never estimates, guesses, or invents a number to fill the gap. Everything in this document describes what unlocks a sharper answer, not a precondition for the dashboard to be useful at all.
