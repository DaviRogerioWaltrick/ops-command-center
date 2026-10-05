import "server-only";
import { getAggregatedData } from "./connectors/registry";
import {
  buildDependencyImpact,
  findItemsBlockedByAbandonedWork,
  inferDependencyEdges,
  mergeDependencyEdges,
  type DependencyImpact,
} from "./dependencies";
import { listConfirmedOverrides } from "./dependency-overrides";
import { computeWorkloadSnapshots } from "./workload";
import { createSingleFlight } from "./single-flight";
import { buildWorkItemFacts } from "./ranking/facts";
import { rankWithRules, rankWorkItems } from "./ranking/engine";
import { rankWorkItemsProbabilistic } from "./ranking/jev";
import { createDemoAsk, DEMO_LABEL, DEMO_NAMESPACE } from "./ranking/jev-demo";
import { applyOperatorOrder } from "./ranking/probabilistic";
import { getOperatorOrder } from "./operator-order";
import type { DependencyEdge, Person, PriorityRankingEntry, WorkItem, WorkloadSnapshot } from "./types";

export type RankingMode = "claude" | "probabilistic" | "demo";

export function rankingMode(): RankingMode {
  const raw = process.env.RANKING_MODE;
  return raw === "probabilistic" ? "probabilistic" : raw === "probabilistic-demo" ? "demo" : "claude";
}

export interface OpsSnapshot {
  people: Person[];
  workItems: WorkItem[];
  workItemsById: Map<string, WorkItem>;
  peopleById: Map<string, Person>;
  impactByItemId: Map<string, DependencyImpact>;
  confirmedEdges: DependencyEdge[];
  /** Open item id -> its confirmed blockers that were abandoned, not delivered. */
  abandonedBlockersByItemId: Map<string, WorkItem[]>;
  inferredEdges: DependencyEdge[];
  workload: WorkloadSnapshot[];
  workloadByPersonId: Map<string, WorkloadSnapshot>;
  ranking: PriorityRankingEntry[];
}

/**
 * The one orchestration point every page reads from: pull every connector →
 * build the confirmed dependency graph → infer likely-but-unconfirmed edges
 * separately → roll up workload → rank. Nothing here is persisted yet — see
 * lib/db/schema.ts and the README for what changes once a database is
 * provisioned (a deliberate step, not automatic).
 *
 * One exception: `dependency-overrides.ts` already works today, in process
 * memory. A promoted link is merged in here as confirmed and removed from
 * `inferredEdges` — once an operator verifies a link, it shows up as a real
 * dependency (in `releasesWorkFor`) everywhere, not as a note asking them to
 * verify it again next render.
 */
export async function buildOpsSnapshot(): Promise<OpsSnapshot> {
  const { people, workItems, dependencyEdges } = await getAggregatedData();

  const [inferredFromAi, overrides] = await Promise.all([inferDependencyEdges(workItems), listConfirmedOverrides()]);
  const { confirmedEdges, inferredEdges } = mergeDependencyEdges(dependencyEdges, inferredFromAi, overrides);

  const impactByItemId = buildDependencyImpact(workItems, confirmedEdges);

  const workload = computeWorkloadSnapshots(people, workItems, impactByItemId);
  const workloadByPersonId = new Map(workload.map((w) => [w.personId, w]));

  const abandonedBlockersByItemId = new Map(
    findItemsBlockedByAbandonedWork(workItems, confirmedEdges).map((o) => [o.item.id, o.abandonedBlockers]),
  );

  const facts = buildWorkItemFacts(workItems, impactByItemId, inferredEdges, workloadByPersonId, abandonedBlockersByItemId);
  // Probabilistic ranking is opt-in until it has been evaluated on fixtures.
  //   RANKING_MODE=probabilistic       ranks with Jev (needs TYPESAFE_API_KEY; costs money).
  //   RANKING_MODE=probabilistic-demo  ranks with a local stand-in that invents plausible
  //                                    distributions, for building the UI. Not Jev output.
  // Unset keeps the Claude ranking. If probabilistic ranking cannot produce a complete
  // result it falls back to the rule-based order, never to a partial mix.
  const mode = rankingMode();
  const ranking =
    mode === "claude"
      ? await rankWorkItems(facts)
      : ((await rankWorkItemsProbabilistic(
          facts,
          mode === "demo" ? { ask: createDemoAsk(), namespace: DEMO_NAMESPACE, estimateLabel: DEMO_LABEL } : {},
        )) ?? rankWithRules(facts));

  return {
    people,
    workItems,
    workItemsById: new Map(workItems.map((i) => [i.id, i])),
    peopleById: new Map(people.map((p) => [p.id, p])),
    impactByItemId,
    confirmedEdges,
    abandonedBlockersByItemId,
    inferredEdges,
    workload,
    workloadByPersonId,
    ranking,
  };
}

const SNAPSHOT_TTL_MS = Number(process.env.OPS_SNAPSHOT_TTL_MS ?? 5 * 60_000);
// A snapshot whose AI ranking fell back to rules is kept only briefly, so a one-off model failure is retried soon instead of shown for minutes.
const DEGRADED_TTL_MS = Math.min(SNAPSHOT_TTL_MS, 30_000);
const buildOnce = createSingleFlight<OpsSnapshot>();
let cached: { builtAt: number; overridesKey: string; ttlMs: number; snapshot: OpsSnapshot } | null = null;

/**
 * What pages call. buildOpsSnapshot makes live AI calls (about 15 seconds
 * measured), which is unusable when every click-through page rebuilds it, so
 * the result is held in process memory for a few minutes. The cache is keyed
 * on the promoted-link overrides, so confirming a link rebuilds immediately.
 * A side effect worth knowing: the AI's output is stable within the window
 * instead of varying per page. Process memory only, like dependency-overrides:
 * it resets on restart and is not shared across serverless instances.
 * Set OPS_SNAPSHOT_TTL_MS=0 to disable.
 */
export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const overrides = await listConfirmedOverrides();
  const overridesKey = overrides.map((o) => `${o.blockerId}>${o.blockedId}`).sort().join("|");
  if (cached && cached.overridesKey === overridesKey && Date.now() - cached.builtAt < cached.ttlMs) {
    return withOperatorOrder(cached.snapshot);
  }
  // Callers that arrive while a build is running share it, so a cold or expired cache
  // costs one Jev pass and one AI dependency call, not one per simultaneous request.
  const snapshot = await buildOnce(overridesKey, async () => {
    const built = await buildOpsSnapshot();
    const degraded = built.ranking.some((entry) => entry.source === "rule-based");
    cached = { builtAt: Date.now(), overridesKey, ttlMs: degraded ? DEGRADED_TTL_MS : SNAPSHOT_TTL_MS, snapshot: built };
    return built;
  });
  return withOperatorOrder(snapshot);
}

/**
 * The operator's tie-break choices are applied on every read, not baked into
 * the cached snapshot: choosing an order is instant and does not rebuild the
 * snapshot (which would repeat the AI dependency inference).
 */
async function withOperatorOrder(snapshot: OpsSnapshot): Promise<OpsSnapshot> {
  if (!snapshot.ranking.some((entry) => entry.probabilistic?.tieGroup)) return snapshot;
  return { ...snapshot, ranking: applyOperatorOrder(snapshot.ranking, await getOperatorOrder()) };
}
