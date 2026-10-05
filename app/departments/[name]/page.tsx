import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemRow } from "@/components/item-row";
import { Card } from "@/components/ui/card";
import { GapNote } from "@/components/ui/gap-note";
import { Stat } from "@/components/ui/stat";
import { getBottlenecks } from "@/lib/bottlenecks";
import { decodeParam, homeHref, personHref } from "@/lib/routes";
import { getOpsSnapshot } from "@/lib/snapshot";
import { DEPARTMENT_TOP, buildPersonRows, computeScopeStats, currentTimeMs, takeTop, teamOf } from "@/lib/views";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DepartmentPage({ params }: PageProps<"/departments/[name]">) {
  const team = decodeParam((await params).name);
  const snapshot = await getOpsSnapshot();
  const now = currentTimeMs();

  const items = snapshot.workItems.filter((i) => teamOf(i) === team);
  if (items.length === 0) notFound();

  const stats = computeScopeStats(items, snapshot.impactByItemId, now);
  const roster = buildPersonRows(snapshot.people, items, snapshot.impactByItemId, now);
  // getBottlenecks sorts by impact, so the first few are the ones worth acting on; the rest are not listed.
  const { shown: bottlenecks, total: bottleneckTotal } = takeTop(
    getBottlenecks(snapshot).filter((row) => teamOf(row.item) === team),
    DEPARTMENT_TOP,
  );

  return (
    <div className="space-y-8">
      <Link href={homeHref()} className="text-sm text-accent-ink hover:underline">
        ← Back to command view
      </Link>
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{team}</h1>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Open" value={stats.open} />
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? "red" : "default"} />
        <Stat
          label="Average cycle time"
          value={stats.cycle.days == null ? "no data" : `${stats.cycle.days.toFixed(1)} d`}
          note={stats.cycle.sample > 0 ? `${stats.cycle.sample} delivered item${stats.cycle.sample === 1 ? "" : "s"}` : undefined}
        />
        <Stat label="People blocked" value={stats.peopleBlocked} tone={stats.peopleBlocked > 0 ? "amber" : "default"} note="confirmed dependencies only" />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Team roster</h2>
        <Card className="divide-y divide-line px-4">
          {roster.map((row) => (
            <div key={row.person.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <Link href={personHref(row.person.id)} className="font-medium text-ink hover:underline">
                {row.person.name}
              </Link>
              <span className="text-xs text-ink-3">
                {row.open} open · <span className={cn(row.overdue > 0 && "text-red")}>{row.overdue} late</span> · on time{" "}
                {row.onTime.rate == null ? "no data" : `${Math.round(row.onTime.rate * 100)}% (n=${row.onTime.sample})`}
              </span>
            </div>
          ))}
        </Card>
        <p className="mt-2 text-xs text-ink-3">Counts cover only this department&apos;s items; a person may own work in other departments too.</p>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium text-ink">Open bottlenecks</h2>
        <Card className="divide-y divide-line px-4">
          {bottlenecks.length === 0 && <p className="py-6 text-sm text-ink-3">No stalled, at-risk, or blocking work in this department.</p>}
          {bottlenecks.map((row) => (
            <ItemRow
              key={row.item.id}
              item={row.item}
              severity={row.severity}
              reasoning={
                row.isStalled
                  ? `Stalled: status "${row.item.status}"`
                  : row.releasesWorkFor.length > 0
                    ? `${row.severity.reason}; blocking ${row.releasesWorkFor.map((p) => p.name).join(", ")}`
                    : row.severity.reason
              }
            />
          ))}
        </Card>
        {bottleneckTotal > bottlenecks.length && (
          <p className="mt-2 text-xs text-ink-3">
            Showing the top {bottlenecks.length} of {bottleneckTotal} open bottlenecks.
          </p>
        )}
      </section>

      <GapNote title="Cycle-time trend">
        A six-month cycle-time trend needs stored history. None is stored yet, so there is nothing to draw; it arrives with the database and scheduled sync.
      </GapNote>
    </div>
  );
}
