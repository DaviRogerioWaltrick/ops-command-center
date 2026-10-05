# ops-command-center

A connector-agnostic control panel for operational decisions. It ranks open work across every connected system (task tracker, CRM, whatever you use) by what each item actually unblocks, not just by what is overdue. Each ranking comes with its reasoning, a workload view, and a bottleneck and dependency drill-down.

It is not a ClickUp dashboard or a Salesforce dashboard. ClickUp, Salesforce and Linear ship as three example adapters to show the abstraction holds. Adding another tool (HubSpot, Monday.com, Jira) is new code in `lib/connectors/`, not a rewrite of anything else.

Built by [Davi Waltrick](https://github.com/DaviRogerioWaltrick), an operations manager who builds systems. Fork it and make it yours.

## Status: v1, runs on invented data

Read this before you rely on it.

- **No live data source and no database.** Every connector reads realistic but invented fixtures (`lib/connectors/*/fixtures.ts`) shaped like real API responses. Nothing has been run against a real workspace.
- **Ranking calibration is unverified.** The probabilistic ranking cannot be validated on invented data, so its percentages are model estimates, and the UI says so.
- **State lives in server memory.** Caches, confirmed links, feedback and tie choices reset on restart.
- **No login.** It assumes a single operator.
- **Known limits and measured costs** are in [`BACKLOG.md`](BACKLOG.md). The competitive research, with dated sources and a list of what could not be verified, is in [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md).

## Quick start

Needs Node.js and npm (developed on Node 25).

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # vitest: rules, dependency graph, ranking, connectors
npm run typecheck
npm run build
```

It works with no environment variables and no API keys. Copy `.env.example` to `.env` to turn on the optional AI layers. You bring your own keys; the repo contains none.

| Mode | How | What you get |
|---|---|---|
| Default | no keys | Rule-based ranking and rule-based dependency detection, with template reasoning. |
| Claude ranking | set `ANTHROPIC_API_KEY` | Model-authored ranking reasoning and AI-inferred dependencies. |
| Probabilistic demo | `RANKING_MODE=probabilistic-demo` | Free. A local stand-in with invented probabilities, for working on the UI. Not model output. |
| Probabilistic (live) | `RANKING_MODE=probabilistic` and `TYPESAFE_API_KEY` | Rank probabilities from TypeSafe's Jev model. This costs money; read the cost notes in `BACKLOG.md` first. |

## Why it is built this way

- **Options, not verdicts.** The AI states its reasoning and uncertainty and leaves the decision to the operator. See [`MANIFESTO.md`](MANIFESTO.md), which is also the data contract: what a connected system must track for the dashboard to reason well.
- **Never invent a number.** Where a source does not supply cost, tracked time or history, the UI shows a gap note, not an estimate.
- **Confirmed and inferred are never mixed.** A dependency a tool states is confirmed. One the AI infers is shown separately, as lower confidence, until an operator promotes it.
- **Graceful degradation.** Every AI layer falls back to a deterministic rule-based result, never to a partial mix.
- **Check before you build.** [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) lists what Asana, monday.com, Salesforce and HubSpot already do natively, so you do not rebuild it.

## Architecture

**Canonical model (`lib/types.ts`)** — `Person`, `WorkItem`, `DependencyEdge`, `WorkloadSnapshot`, `PriorityRankingEntry`. Every connector maps its own vocabulary into these; nothing past the adapter layer ever looks at a source-specific field again.

**Connectors (`lib/connectors/`)** — one adapter per source, each implementing the `Connector` interface (`listPeople`, `listWorkItems`, `listDependencyEdges`). `registry.ts` aggregates every connected source and merges a person seen in two systems under the same email into one identity — this is why "Marcus Lee" shows up as a single person with combined workload even though he's a ClickUp assignee in one fixture and a Salesforce owner in the other.

**Dependency graph (`lib/dependencies.ts`)** — two distinct signals, never conflated:
- `buildDependencyImpact` — deterministic, reads only *confirmed* edges (a connector's own relationship data: ClickUp task links, Salesforce related records). Answers "if this ships, whose work opens up?" Source-agnostic by design — a confirmed edge between two different connectors' items is exactly as valid as one within a single source (ids are already namespaced), even though in practice no single connector's own API could ever produce one. The only way a *cross-source* dependency is ever found at all is the inference layer below — see `COMPETITIVE_ANALYSIS.md`.
- `inferDependencyEdges` — AI reads task scope/notes for likely-but-unstated dependencies. Returned as `confidence: "inferred"`, surfaced in the UI as a separate, visibly lower-confidence note — never merged into `releasesWorkFor`.
- `mergeDependencyEdges` + `lib/dependency-overrides.ts` — an operator can promote a verified inferred link to confirmed (a "Confirm this link" button on any inferred note). This is the dependency-graph equivalent of a ranking feedback loop: once promoted, the edge counts as confirmed everywhere and stops showing up as a note asking to be re-verified. The override store is process-memory for now (resets on restart) — the interaction is real; only the storage backend changes once a database exists.

**Rules (`lib/rules/severity.ts`)** — RAG severity from `isDone`/`dueDateMs` only. No source-specific field lookups here, by design — a connector that wants to feed in its own "marked delayed" signal normalizes it into `WorkItem.status`/`isDone` during mapping, not by adding a special case to this file.

**Ranking (`lib/ranking/`)** — `facts.ts` builds deterministic per-item facts (severity + dependency impact + owner's current workload). `engine.ts` sends those facts to Claude for a ranked list with reasoning per item, falling back to a deterministic rule-based ranking (weighted: severity, people released, inferred-blocking notes) on any failure — same graceful-degradation contract used throughout.

**Workload (`lib/workload.ts`)** — live per-person rollup (open/overdue/closed-last-7d/blocking-others). This is *not* history yet — see below.

**UI** — a click-through drill-down: `/` (command view, company-wide or per department via `?dept=`), `/departments/[name]`, `/people/[id]`, `/items/[id]` (dependency chain, AI reasoning, confirm-link). Read-models live in `lib/views.ts` (pure, tested); pages call `getOpsSnapshot()` in `lib/snapshot.ts`, which caches the AI-backed snapshot in process memory for 5 minutes (`OPS_SNAPSHOT_TTL_MS`; 0 disables). Anything needing stored history (trends) or data no source supplies (cost) renders an explicit gap note, never an invented figure. `/bottlenecks` and `/workload` were retired and redirect to `/`. The theme is dark-only (tokens in `app/globals.css`); charts are server-rendered SVG/HTML in `components/charts/`.

## Development phase (not started)

`lib/db/schema.ts` defines the persistence layer this needs: `workItems`, `dependencyEdges`, `dependencyOverrides`, `workloadSnapshots`, `priorityRankings`, `rankingFeedback`. Nothing connects to a database yet. `lib/db/client.ts` is a lazy accessor that throws a clear error if called before `DATABASE_URL` exists, and nothing calls it. The plan, once you start:

1. Provision Postgres and run the schema.
2. Add a scheduled sync that pulls every connector, upserts `workItems`, and writes one `workloadSnapshots` row per person. This is what turns "workload right now" into history.
3. Persist every ranking run to `priorityRankings`, so "why did this move up" is answerable later.
4. Swap the fixtures for real API calls. Hosting and database choices depend on your environment; none is assumed here.

## Adding a new connector

1. Create `lib/connectors/<source>/adapter.ts` implementing `Connector` from `lib/connectors/types.ts`.
2. Map that source's own vocabulary into `Person`/`WorkItem`/`DependencyEdge` — see `clickup/adapter.ts` and `salesforce/adapter.ts` for two intentionally different examples (list/task vocabulary vs. opportunity/stage vocabulary) mapping into the same shape.
3. Register it in `lib/connectors/registry.ts`.

Nothing in `lib/rules`, `lib/dependencies.ts`, `lib/ranking`, `lib/workload.ts`, or `app/` needs to change. Three example connectors exist (ClickUp, Salesforce, Linear); `linear/` is the one that exercises inverse-direction dependencies and state categories where two of them (canceled, duplicate) close an issue without delivering it; its fixture follows the structure of Linear's real GraphQL schema.
