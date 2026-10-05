# Design: probabilistic ranking with TypeSafe (Jev)

Status: **design approved Oct 1, 2026; backend and UI built against a demo stand-in (no live Jev call yet).** Written Oct 1, 2026. Fake fixtures only so far.

## Goal

Replace "a hand-weighted score plus an AI-chosen order that can contradict it" with one quantity: for every open item, the probability of landing at each rank. Items are **ordered by expected rank**. The UI shows the same distribution that produced the order, so the number and the rank cannot disagree.

## Known and verified (from TypeSafe's own docs, read Oct 1)

- `POST https://api.typesafe.ai/v1/systemone`, bearer auth; JS SDK `@typesafe-ai/sdk` (Node 20+), env var `TYPESAFE_API_KEY`; model `jev-latest`.
- Request = one `state` (string/object/array of text) + a map of `questions`. All questions on one state run in parallel and cannot see each other.
- **Score**: 2 to 10 ordered levels; returns `probabilities` per level (sum 1), `score` (probability-weighted position), `confidence` (0 to 1 from how spread the distribution is). Different distributions can share one `score`, so the probabilities are the real output.
- Token usage (`input_tokens`, `output_tokens`) is returned on every response.
- Errors: 401 bad key, 422 validation, 429/529 rate limit or overload (SDK retries with backoff).
- Jev 1.13 limitations: not a calculator; reads dates as text; large or irrelevant state degrades accuracy; injected instructions in the state can steer it; English works best.
- Listed price: $42 per billion input tokens (output price not found).

## Needs checking (not known)

- Output-token price, rate limits, free tier. (Oct 2: the dashboard's spend is consistent with the listed input price applying to our account; see BACKLOG.md, "Measured costs", for the measured figures.)
- Whether Jev returns identical probabilities for identical input (affects whether we need caching for stability or only for cost).
- Whether the probabilities are calibrated for operations prioritization. **Cannot be tested on mock data.** The UI must call them model estimates.
- Exact SDK types for Score (`score()` helper arguments and the `answers.<key>` shape): the SDK is not installed yet, so read its installed types first.

## Architecture

Code owns the facts and the arithmetic; Jev supplies only semantic judgment.

### 1. Deterministic inputs (code, unchanged from `lib/ranking/facts.ts`)

`daysUntilDue`, severity (days overdue), due-within-7-days, owner open and overdue counts, confirmed `releasesWorkFor` count, abandoned-blocker flag. Exact numbers, never sent to Jev as quantities to compare.

### 2. Jev judgments (one request per item, questions in parallel)

State per item is a small named object: title, initiative, team, scope text, latest note, names of people released, inferred-block notes (labelled "unconfirmed, AI-inferred"), abandoned-blocker titles and why they were dropped. No other items, no numbers to compare. Two Score questions to start, each with 5 concrete levels (0 to 4):

| Dimension | Framework axis | Question (draft) |
| --- | --- | --- |
| Leverage | Scope | How much does finishing this item unblock other people or change what the organization can do? |
| Slip risk | Time / Resources | Does the latest note and scope text show this item is stalled or at real risk, or is it merely old? |

Levels must describe concrete situations (their guidance). Final wording is a decision for the operator, because the levels encode their judgment.

### 3. Composite and simulation (pure code, `lib/ranking/probabilistic.ts`)

Priority index per item = sum of weight x normalized dimension, where the deterministic dimensions are fixed values and each Jev dimension is **sampled** from its probability distribution. Repeat N = 2,000 times with a seeded random generator (seed from a hash of the inputs, so a page reload does not reshuffle). Per item the output is:

- `rankProbabilities[k]` = share of runs ending at rank k+1
- `expectedRank` = mean rank (the sort key; ties broken by soonest due date, as today)
- `pTop1`, `pTop3`, `pTop10` derived from the distribution
- `confidence` = lowest Jev confidence among the item's dimensions (shown, not hidden)

Weights live in one constants block and are normalized. Changing a weight reruns only the simulation, not Jev.

Assumptions to state in the UI and docs: items and dimensions are sampled independently (correlation is not modeled); the starting weights are judgment values, not derived from data (the existing 40 / 20 / 30 / 10 weights are a starting point to normalize, to be chosen by the operator).

### 4. Fallback chain

Jev unavailable, over budget, or incomplete for any item: fall back to `rankWithRules`, labelled as such, exactly as the Claude path does today. A partial Jev result is never mixed in.

### 5. Reasoning text

v1: build the one-line reasoning deterministically from the facts and the dominant dimension (reuse `ruleBasedReason`). This removes the 15 to 20 second Claude call from every cold page load. Claude narration can be added later as an optional layer. (Decision below.)

## Where it plugs in

- New: `lib/ranking/jev.ts` (SDK client, server-only, injectable like `RankingGenerator`), `lib/ranking/probabilistic.ts` (simulation), tests for both.
- `lib/snapshot.ts` calls the probabilistic ranker where it calls `rankWorkItems` today.
- `PriorityRankingEntry` gains optional `expectedRank`, `rankProbabilities`, `pTop1`, `confidence`, and `source: "probabilistic"`. `score` stays for the rule-based fallback (open question below).
- API key is read only on the server; never sent to the browser.

## UI

- Ranked rows: "Expected #3.2 · 41% chance of #1 · 78% in top 3", a confidence badge, and a small strip showing the distribution across rank positions.
- Adjacent items whose expected ranks are close are flagged as a toss-up instead of implying a strict order.
- Item page: per-dimension breakdown (Jev level probabilities and confidence) beside the deterministic facts, with the words "model estimate, not calibrated".
- Command-view KPI: one line showing Jev token usage for the last run.

## Cost control (conservative)

- Unknown cost structure, so: meter `Usage` on every call; per-item cache keyed by a hash of the item state plus question version, so only changed items are re-asked; a cap on items asked per run (default 150, `JEV_MAX_ITEMS`); fixtures only. **Changed Oct 4, 2026:** over the cap the whole ranking no longer falls back to rules. The best items by exact facts are assessed, the rest follow ordered by exact facts only and are marked not assessed (`selectForAssessment` in `lib/ranking/probabilistic.ts`). The model can add at most 0.35 to an item's index, which is large next to the gaps between exact scores, so a guarantee about the top positions rarely holds on a typical mix (synthetic checks: needing 45% to 100% of the items assessed); the page says so rather than implying certainty.
- Measured Oct 2 on the 15 fake fixtures: about 674 input and 34 output tokens per item (so the earlier guess of 1,000 input per item was high for fixtures); about $0.0004 per cold 15-item pass. Real items with longer notes and scope text will be larger, so re-measure on the first real pass. Figures are in BACKLOG.md under "Measured costs".

## Testing

- Unit tests with an injected fake Jev client: simulation is deterministic for a seed; certain distributions give probability 1; ties; weight changes alter order; an incomplete or failed Jev result triggers the fallback.
- Live evaluation script, fixtures only: repeat the same snapshot several times to see probability stability; sensitivity to weights; total tokens. It makes no calibration claim.
- Prompt-injection note: titles and notes are untrusted. Score output is bounded to levels, so an injected instruction can at most shift a level by one judgment, and weights are in code. Not a full defense; record as a known limit.

## Decisions

1. Dimensions and level wording (the two above are drafts).
2. Starting weights across Leverage, Slip risk, severity/overdue, due-soon, owner load, replan flag.
3. Reasoning text: deterministic in v1 (recommended), or keep a Claude narration call?
4. What happens to `score`: hide it for probabilistic entries (recommended) or show the expected priority index?
5. Toss-up threshold: how close must expected ranks be to flag a toss-up?

## Decisions log (Oct 1, 2026)

- **Reasoning text: deterministic in v1.** Decided. No Claude narration call.
- **`score` hidden for probabilistic entries.** Decided, to avoid confusion. It stays only on the rule-based fallback.
- **Ties: no automatic tie-break; the operator decides.** Rule: items are only treated as tied when they are equal, and the choice of which goes first is the operator's. Proposed definition of "equal" (pending confirmation): expected ranks that are statistically indistinguishable, meaning their difference is within the simulation's own standard error, plus exact ties from identical inputs. The tied items are shown together as "needs your call" with a control to place one first; the choice reorders only inside the tie group and never changes the probabilities. The probabilistic path drops the soonest-due tie-break; the rule-based fallback keeps it.
- **Tie rule confirmed (Oct 1):** items are tied only when statistically indistinguishable (gap within the simulation's standard error) or exactly equal; the operator decides the order inside a tie group; tie choices held in memory like feedback verdicts until a database exists.
- **Dimensions confirmed (Oct 1):** Leverage (scope) and Slip risk (time/resources), with the five-level wording drafted in conversation. Time pressure and owner load stay in code.
- **Working mode:** remaining decisions are settled one at a time, in order.
- **Starting weights accepted (Oct 1):** severity 0.25, Leverage 0.20, confirmed releases 0.15 (people released, capped at 3, divided by 3), Slip risk 0.15, re-plan flag 0.15, due-soon 0.10 (1 if overdue or due today, falling linearly to 0 at 7 or more days), owner load 0 (shown as a flag only, not scored). Sum 1.00. Normalizations: severity red 1.0, amber 0.5, green 0.1; Jev levels divided by 4. Judgment values, not derived from data. Known overlaps: Leverage and confirmed releases partly double-count; severity and due-soon both reward overdue items. Unconfirmed AI-inferred blocks get no direct weight.

## Jev question wording (draft v1; confirmed dimensions, levels 0 to 4)

**Leverage (scope).** Instructions: How much does finishing this item unblock other people or change what the organization can do?
- 0: Affects only its own owner; nothing waits on it.
- 1: Marginal: a small improvement or convenience for one other person.
- 2: Moderate: one other person or one project is waiting on it.
- 3: Significant: several people or an important initiative depend on it.
- 4: Critical: a cross-team or company-level commitment cannot proceed without it.

**Slip risk (time and resources).** Instructions: Does the latest note and scope text show this item is stalled or at real risk, or is it merely old?
- 0: Healthy: active progress, nothing suggests delay.
- 1: Quiet: no recent update but no sign of trouble.
- 2: Uncertain: the notes hint at delay, unclear ownership or an unresolved question.
- 3: At risk: the notes describe a specific obstacle or missed commitment.
- 4: Stalled or failing: explicitly blocked, abandoned or contradicted by recent events.

Question wording and level text carry no numbers or dates to compare; per Jev's own docs, each level stands alone as a concrete situation. Wording is versioned: any change invalidates the per-item cache.
