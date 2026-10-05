import Link from "next/link";
import { DepartmentBars } from "@/components/charts/department-bars";
import { WorkloadScatter } from "@/components/charts/workload-scatter";
import { ItemRow } from "@/components/item-row";
import { TopLimitMenu } from "@/components/top-limit-menu";
import { Stat } from "@/components/ui/stat";
import { Card } from "@/components/ui/card";
import { GapNote } from "@/components/ui/gap-note";
import { cn } from "@/lib/utils";
import { getInferenceMeter, inferredLinksFor } from "@/lib/dependencies";
import { companyTopHref, homeHref, personHref } from "@/lib/routes";
import { getWorkItemSeverity } from "@/lib/rules/severity";
import { getJevMeter } from "@/lib/ranking/jev";
import { getOpsSnapshot, rankingMode } from "@/lib/snapshot";
import {
  COMPANY_TOP_OPTIONS,
  buildDepartmentRows,
  buildPersonRows,
  computeScopeStats,
  countTiesToDecide,
  currentTimeMs,
  describeAxes,
  describeInferenceUsage,
  teamOf,
  topLimit,
} from "@/lib/views";

// Live data once real connectors are wired in: never bake a ranking into a static build.
export const dynamic = "force-dynamic";

const pct = (rate: number | null) => (rate == null ? "no data" : `${Math.round(rate * 100)}%`);

export default async function CommandView({ searchParams }: PageProps<"/">) {
  const snapshot = await getOpsSnapshot();
  const now = currentTimeMs();

  const departments = buildDepartmentRows(snapshot.workItems, now);
  const params = await searchParams;
  const requested = params.dept;
  const dept = typeof requested === "string" && departments.some((d) => d.team === requested) ? requested : null;

  const scoped = dept ? snapshot.workItems.filter((i) => teamOf(i) === dept) : snapshot.workItems;
  const stats = computeScopeStats(scoped, snapshot.impactByItemId, now);
  const people = buildPersonRows(snapshot.people, scoped, snapshot.impactByItemId, now);
  const mode = rankingMode();
  const probabilistic = snapshot.ranking.some((entry) => entry.source === "probabilistic");
  const meter = getJevMeter();
  const inference = describeInferenceUsage(getInferenceMeter());
  const inScope = snapshot.ranking
    .filter((entry) => {
      const item = snapshot.workItemsById.get(entry.workItemId);
      return item && (!dept || teamOf(item) === dept);
    })
    .sort((a, b) => a.rank - b.rank);
  // Only the top few are listed: 5 in a department, 5 or 10 company-wide. The rest are not shown, so the
  // page stays short. The tie count covers only what is listed.
  const limit = topLimit(dept, params.top);
  const ranked = inScope.slice(0, limit);
  const tiesToDecide = countTiesToDecide(ranked);
  const coverage = snapshot.ranking.find((entry) => entry.unassessed)?.unassessed;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{dept ?? "Company-wide"}</h1>
          <p className="mt-1 text-sm text-ink-3">Ranked across every connected source, weighted by what each item unblocks.</p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Scope">
          {[{ label: "Company-wide", href: homeHref(), active: dept == null }, ...departments.map((d) => ({ label: d.team, href: homeHref(d.team), active: dept === d.team }))].map((pill) => (
            <Link
              key={pill.label}
              href={pill.href}
              className={cn(
                "rounded-full border px-3 py-1",
                pill.active
                  ? "border-accent bg-accent text-white"
                  : "border-line text-ink-2 hover:border-ink-3",
              )}
            >
              {pill.label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Open work" value={stats.open} />
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? "red" : "default"} />
        <Stat
          label="Average cycle time"
          value={stats.cycle.days == null ? "no data" : `${stats.cycle.days.toFixed(1)} d`}
          note={stats.cycle.sample > 0 ? `created to closed, ${stats.cycle.sample} delivered item${stats.cycle.sample === 1 ? "" : "s"}` : "no delivered items with dates yet"}
        />
        <Stat label="People blocked" value={stats.peopleBlocked} tone={stats.peopleBlocked > 0 ? "amber" : "default"} note="confirmed dependencies only" />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Workload by department</h2>
        <Card>
          <DepartmentBars rows={departments} activeTeam={dept} />
        </Card>
        <p className="mt-2 text-xs text-ink-3">Bars count open items. Weighting by time needs tracked time, which no connected source supplies yet.</p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Who is carrying the load</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <WorkloadScatter rows={people} />
          </Card>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-normal">Person</th>
                  <th className="px-2 py-2 font-normal">Open</th>
                  <th className="px-2 py-2 font-normal">Overdue</th>
                  <th className="px-2 py-2 font-normal">On time</th>
                  <th className="px-4 py-2 font-normal">Blocking others</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {people.map((row) => (
                  <tr key={row.person.id}>
                    <td className="px-4 py-2">
                      <Link href={personHref(row.person.id)} className="font-medium text-ink hover:underline">
                        {row.person.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{row.open}</td>
                    <td className={cn("px-2 py-2", row.overdue > 0 && "text-red")}>{row.overdue}</td>
                    <td className="px-2 py-2 text-ink-2">
                      {pct(row.onTime.rate)}
                      {row.onTime.sample > 0 && <span className="text-xs text-ink-3"> (n={row.onTime.sample})</span>}
                    </td>
                    <td className="px-4 py-2">{row.blockingOthers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <p className="mt-2 text-xs text-ink-3">On time uses delivered items that have both a due and a close date. The table is the full set; the chart plots only people with that history.</p>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-ink">{probabilistic ? "Priorities by expected rank" : "AI-ranked priorities"}</h2>
          {!dept && <TopLimitMenu current={limit} options={COMPANY_TOP_OPTIONS.map((value) => ({ value, href: companyTopHref(value) }))} />}
        </div>
        {probabilistic && (
          <div className="mb-3 space-y-2 text-xs text-ink-3">
            <p>
              Each item shows the simulated chance of landing at every rank. These are model estimates, not calibrated on real
              outcomes. Items whose expected ranks cannot be told apart are marked tied, and the order inside a tie is yours to choose.
            </p>
            {mode === "demo" && (
              <p className="rounded-lg border border-amber/50 p-3 text-amber">
                Demo mode: the judgments behind these percentages are invented by a local stand-in, not by Jev. They show how the
                screen will behave and say nothing about the real model.
              </p>
            )}
            {mode === "probabilistic" && (
              <>
                <p>
                  Jev usage since the server started: {meter.requests} request{meter.requests === 1 ? "" : "s"}, {meter.cacheHits} reused,{" "}
                  {meter.failures} failed, {meter.inputTokens.toLocaleString("en-US")} input and {meter.outputTokens.toLocaleString("en-US")} output
                  tokens. The token counts leave out failed requests, so the provider dashboard is the billing record.
                </p>
                <p>{inference.usage}</p>
                {inference.failure && <p className="text-amber">{inference.failure}</p>}
                {meter.fallbacks > 0 && (
                  <p className="text-amber">
                    Ranking fell back to the rule-based order {meter.fallbacks} time{meter.fallbacks === 1 ? "" : "s"}. Last cause:{" "}
                    {meter.lastFailure ?? "unknown"}.
                  </p>
                )}
              </>
            )}
            {coverage && (
              <p>
                Jev assessed {coverage.assessed} of {coverage.total} open items: the ones with the strongest exact facts (lateness,
                due dates, links). The rest are listed after them, ordered by exact facts only, with no rank probabilities.{" "}
                {coverage.guaranteedTop > 0
                  ? `The top ${coverage.guaranteedTop} positions cannot change even if every item were assessed.`
                  : "No position is guaranteed: an item that was not assessed could belong higher than shown."}
              </p>
            )}
            {tiesToDecide > 0 && (
              <p className="text-amber">
                {tiesToDecide} tie{tiesToDecide === 1 ? " needs" : "s need"} your call.
              </p>
            )}
          </div>
        )}
        <Card className="divide-y divide-line px-4">
          {ranked.length === 0 && <p className="py-6 text-sm text-ink-3">Nothing open in this scope.</p>}
          {ranked.map((entry, index) => {
            const item = snapshot.workItemsById.get(entry.workItemId)!;
            const axes = describeAxes(
              item,
              snapshot.impactByItemId.get(item.id),
              inferredLinksFor(item.id, snapshot.inferredEdges, snapshot.workItemsById).length,
              now,
              snapshot.abandonedBlockersByItemId.get(item.id)?.length ?? 0,
            );
            return (
              <ItemRow
                key={entry.workItemId}
                item={item}
                severity={getWorkItemSeverity(item)}
                rank={dept ? index + 1 : entry.rank}
                reasoning={entry.reasoning}
                axes={axes}
                aiUnavailable={entry.source === "rule-based"}
                probabilistic={entry.probabilistic}
                companyWide={dept != null}
              />
            );
          })}
        </Card>
        {inScope.length > ranked.length && (
          <p className="mt-2 text-xs text-ink-3">
            Showing the top {ranked.length} of {inScope.length} open items.
          </p>
        )}
      </section>

      <GapNote title="Trends over time">
        Sparklines need stored history, which starts once a database and scheduled sync exist. Nothing is drawn until then, so no line is invented.
      </GapNote>
    </div>
  );
}
