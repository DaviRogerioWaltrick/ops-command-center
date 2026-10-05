# Backlog: known limits, measured costs and deferred work

State as of October 5, 2026. All measurements were taken on invented data, so treat them as a floor for planning and re-measure on your own data.

## Measured costs (invented data, October 2026)

These are token counts and timings from live runs of the two AI layers. Dollar figures are estimates at the listed price, not billing records.

**Probabilistic ranking (TypeSafe Jev), one request per item, two score questions each:**
- A cold pass over 15 items: 15 requests, about 10.1k input and 510 output tokens (about 674 and 34 per item), 2 to 4 seconds. At the listed input price of $42 per billion tokens that is about $0.0004. The spend a provider dashboard shows may differ; verify against your own billing.
- 150 short synthetic items with 4 requests in flight: about 11 seconds cold, 93,078 input and 5,100 output tokens, no failures and no rate limit hit. A repeat took 34 ms from the cache.
- Cost scales roughly linearly with the number of items asked. Real items with longer notes cost more per item.
- A per-item cache (process memory) means a rerun on unchanged state costs nothing. Only changed items are asked again. A server restart makes the next pass cold.
- `JEV_MAX_ITEMS` (default 150) caps how many items a pass asks about. More open items than that are ranked below the assessed ones by exact facts only and marked "not assessed".

**AI dependency inference (Anthropic), one call per snapshot rebuild:**
- Full run: about 86 to 89 input tokens per item with short notes (13.3k at 150 items, 34.5k at 400, about 20 seconds at 400), and about 171 per item with notes twice as long.
- Planted links were found 10 of 10 at 150 items and 26 of 27 at 400, with no spurious links. Real text, near-duplicate titles and more than 400 items were not tested.
- Per-item memory: a rebuild with nothing changed makes no request. After 5 changed items and 1 new one at 150 items, a run sent 5.0k input and 0.15k output tokens. A full run happens on the first call, after a restart, and hourly (`INFERENCE_FULL_REFRESH_MS`).
- Dollar cost of this layer was not computed.

**Not verified:** rate limits on a real account, behavior beyond 150 assessed items or 400 inferred items, real-text cost and speed, and whether the probabilities are calibrated.

## Known limits

- **The top-positions guarantee rarely holds.** The model can add up to 0.35 to an item's index, which is large next to the gaps between exact scores. When no position can be guaranteed, the page says so. A lower ceiling on what the model may add is a design decision to revisit with real data.
- **A cross-item link can lag.** An unchanged item whose note names an item created later is not found by an incremental inference run. The next full run finds it, so it can wait up to an hour.
- **Process memory only.** The snapshot cache (5 minutes), the Jev cache, the inference memory, confirmed-link overrides, ranking feedback and tie choices all reset on restart and are not shared across instances.
- **No back-off when Jev fails.** A failed pass is retried about every 30 seconds.
- **No authentication.** v1 assumes a single operator.
- **Inference comment mismatch.** The comment above `inferDependencyEdges` says it covers only items with no confirmed links, but the code sends every open item.
- **The Linear connector is a fixture, not a live client.** The fixture and adapter follow Linear's public GraphQL schema (`state { name type }`, relations read from `inverseRelations`, comments as a connection, `duplicate` mapped to abandoned). A live connector still needs the query itself, pagination of relations and comments, and a check that the published schema matches the deployed API.

## Deferred: needs a real data source

- **Workload measured in tracked or estimated time, not open-item count.** Needs a connector that supplies `WorkItem.timeTrackedMs`.
- **Historical duration by category.** Needs real, categorized, time-tracked history.
- **Initiative-level completion percentage.** Computable once enough sibling items under one parent are synced.
- **Cost-of-delay display.** Only when a source provides both a cost rate per person and tracked time for everyone involved. Never estimate it from partial data.
- **Commitment-versus-delivery check.** Needs a connector that exposes both a scope or commitment field and an activity trail.
- **Re-check the ranking weights on real data.** On 15 invented items, being late and being due soon decided about 70% of the order, and the exact weights barely changed it. Repeat the check on real items before tuning anything.

## Deferred: needs the development phase (database, scheduled sync)

- Provision Postgres and run `lib/db/schema.ts`.
- A scheduled sync that pulls every connector, upserts `workItems` and writes one `workloadSnapshots` row per person per run.
- Persist ranking runs to `priorityRankings`, and build a "how did this ranking change over the last N runs" view.
- Replace the in-memory stores (`dependency-overrides.ts`, `ranking-feedback.ts`, `operator-order.ts`) with tables.
- The `rankingFeedback` read path: decide how past feedback is fed back into the ranking prompt, and whether "rank should differ" should require a reason.
- Trend panels (KPI sparklines, on-time and cycle-time trends), which need stored history.
- Live connectors, with retry, back-off and pagination in a shared HTTP helper.
- Whether to run a scheduled background sync with stored results or rebuild on each page view. Page loads currently wait on the AI (about 11 seconds for Jev at 150 items, about 20 seconds for inference at 400). The answer depends on your hosting, which this repo does not assume.
