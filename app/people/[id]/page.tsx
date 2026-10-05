import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemRow } from "@/components/item-row";
import { Card } from "@/components/ui/card";
import { GapNote } from "@/components/ui/gap-note";
import { Stat } from "@/components/ui/stat";
import { decodeParam, departmentHref, homeHref } from "@/lib/routes";
import { getWorkItemSeverity } from "@/lib/rules/severity";
import { getOpsSnapshot } from "@/lib/snapshot";
import { buildPersonRows, currentTimeMs } from "@/lib/views";

export const dynamic = "force-dynamic";

const LEVEL_ORDER = { red: 0, amber: 1, green: 2 } as const;

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const id = decodeParam((await params).id);
  const snapshot = await getOpsSnapshot();
  const person = snapshot.peopleById.get(id);
  if (!person) notFound();

  const now = currentTimeMs();
  const owned = snapshot.workItems.filter((i) => i.assignee?.id === person.id);
  const row = buildPersonRows([person], owned, snapshot.impactByItemId, now)[0];
  const open = owned
    .filter((i) => !i.isDone)
    .map((item) => ({ item, severity: getWorkItemSeverity(item) }))
    .sort((a, b) => LEVEL_ORDER[a.severity.level] - LEVEL_ORDER[b.severity.level]);
  const sources = [...new Set(person.sourceRefs.map((r) => r.source))];

  return (
    <div className="space-y-8">
      <Link href={homeHref()} className="text-sm text-accent-ink hover:underline">
        ← Back to command view
      </Link>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{person.name}</h1>
        <p className="mt-1 text-sm text-ink-3">
          {row?.teams.map((team, i) => (
            <span key={team}>
              {i > 0 && ", "}
              <Link href={departmentHref(team)} className="hover:underline">
                {team}
              </Link>
            </span>
          ))}
          {sources.length > 0 && <span className="capitalize"> · seen in {sources.join(", ")}</span>}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Open" value={row?.open ?? 0} />
        <Stat label="Overdue" value={row?.overdue ?? 0} tone={(row?.overdue ?? 0) > 0 ? "red" : "default"} />
        <Stat
          label="On time"
          value={row?.onTime.rate == null ? "no data" : `${Math.round(row.onTime.rate * 100)}%`}
          note={row && row.onTime.sample > 0 ? `${row.onTime.sample} delivered item${row.onTime.sample === 1 ? "" : "s"} with due and close dates` : "no delivered items with both dates"}
        />
        <Stat label="Blocking others" value={row?.blockingOthers ?? 0} tone={(row?.blockingOthers ?? 0) > 0 ? "amber" : "default"} note="confirmed dependencies only" />
      </section>

      <GapNote title="Track record over time">
        A six-month on-time trend against a team target is not shown. Only the current figure above is real; a trend needs stored history, and a team target needs a number you choose. Neither exists yet, so no line is drawn.
      </GapNote>

      <section>
        <h2 className="mb-1 text-sm font-medium text-ink">Open work</h2>
        <Card className="divide-y divide-line px-4">
          {open.length === 0 && <p className="py-6 text-sm text-ink-3">No open items.</p>}
          {open.map(({ item, severity }) => (
            <ItemRow key={item.id} item={item} severity={severity} />
          ))}
        </Card>
      </section>
    </div>
  );
}
