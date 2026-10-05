import Link from "next/link";
import { notFound } from "next/navigation";
import { AxisReadoutCells } from "@/components/axis-readout";
import { ConfirmLinkButton } from "@/components/confirm-link-button";
import { DimensionBreakdown, LEVERAGE_TITLE, SLIP_RISK_TITLE } from "@/components/dimension-breakdown";
import { RankStrip, RankSummary, TieNote } from "@/components/rank-probability";
import { FeedbackForm } from "@/components/feedback-form";
import { Card } from "@/components/ui/card";
import { GapNote } from "@/components/ui/gap-note";
import { RagBadge } from "@/components/ui/rag-badge";
import { inferredLinksFor } from "@/lib/dependencies";
import { decodeParam, departmentHref, homeHref, itemHref, personHref } from "@/lib/routes";
import { getWorkItemSeverity } from "@/lib/rules/severity";
import { listFeedbackForItem } from "@/lib/ranking-feedback";
import { getOpsSnapshot, rankingMode } from "@/lib/snapshot";
import { describeAxes, openBlockersOf, teamOf, currentTimeMs } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: PageProps<"/items/[id]">) {
  const id = decodeParam((await params).id);
  const snapshot = await getOpsSnapshot();
  const item = snapshot.workItemsById.get(id);
  if (!item) notFound();

  const now = currentTimeMs();
  const severity = getWorkItemSeverity(item);
  const impact = snapshot.impactByItemId.get(item.id);
  const inferredLinks = inferredLinksFor(item.id, snapshot.inferredEdges, snapshot.workItemsById);
  const abandonedBlockers = snapshot.abandonedBlockersByItemId.get(item.id) ?? [];
  const axes = describeAxes(item, impact, inferredLinks.length, now, abandonedBlockers.length);
  const entry = snapshot.ranking.find((r) => r.workItemId === item.id);
  const waitingOn = openBlockersOf(item.id, snapshot.impactByItemId, snapshot.workItemsById);
  const feedbackHistory = await listFeedbackForItem(item.id);
  const unlocks = (impact?.blockedItemIds ?? []).map((blockedId) => snapshot.workItemsById.get(blockedId)).filter((i) => i != null);

  return (
    <div className="space-y-8">
      <Link href={homeHref()} className="text-sm text-accent-ink hover:underline">
        ← Back to command view
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{item.title}</h1>
          <p className="mt-1 text-sm text-ink-3">
            <span className="capitalize">{item.source}</span> · {item.status}
            {item.outcome && <> · {item.outcome}</>}
            {item.assignee && (
              <>
                {" · "}
                <Link href={personHref(item.assignee.id)} className="hover:underline">
                  {item.assignee.name}
                </Link>
              </>
            )}
            {" · "}
            <Link href={departmentHref(teamOf(item))} className="hover:underline">
              {teamOf(item)}
            </Link>
          </p>
        </div>
        <RagBadge level={severity.level} label={severity.reason} />
      </div>

      <Card className="p-4">
        <AxisReadoutCells axes={axes} />
      </Card>

      {abandonedBlockers.length > 0 && (
        <Card className="border-amber/50 p-4">
          <h2 className="text-sm font-medium text-amber">Needs re-planning</h2>
          <p className="mt-1 text-sm text-ink-2">
            This was waiting on work that was abandoned, not delivered, so the blocker will never arrive:{" "}
            {abandonedBlockers.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ", "}
                <Link href={itemHref(b.id)} className="underline">
                  {b.title}
                </Link>
              </span>
            ))}
            .
          </p>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink">What closing this unlocks</h2>
        <Card className="space-y-3 p-4 text-sm">
          {unlocks.length === 0 && inferredLinks.length === 0 && <p className="text-ink-3">Nothing is recorded as waiting on this.</p>}
          {unlocks.map((blocked) => (
            <div key={blocked.id} className="flex items-baseline justify-between gap-3">
              <Link href={itemHref(blocked.id)} className="font-medium text-ink hover:underline">
                {blocked.title}
              </Link>
              <span className="text-xs text-ink-3">confirmed{blocked.assignee && ` · ${blocked.assignee.name}`}</span>
            </div>
          ))}
          {inferredLinks.map((link) => (
            <div key={link.blockedId} className="border-t border-line pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={itemHref(link.blockedId)} className="font-medium text-ink hover:underline">
                  {link.blockedTitle}
                </Link>
                <span className="text-xs font-medium text-amber">AI-inferred, not a native link</span>
              </div>
              <p className="mt-1 text-ink-2">{link.note}</p>
              <div className="mt-1">
                <ConfirmLinkButton blockerId={link.blockerId} blockedId={link.blockedId} note={link.note} />
              </div>
            </div>
          ))}
        </Card>
      </section>

      {waitingOn.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink">Waiting on</h2>
          <Card className="space-y-2 p-4 text-sm">
            {waitingOn.map((blocker) => (
              <div key={blocker.id} className="flex items-baseline justify-between gap-3">
                <Link href={itemHref(blocker.id)} className="font-medium text-ink hover:underline">
                  {blocker.title}
                </Link>
                <span className="text-xs text-ink-3">confirmed</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink">Why it is ranked where it is</h2>
        <Card className="p-4 text-sm text-ink-2">
          {entry ? (
            <>
              <p>
                <span className="font-semibold text-ink">#{entry.rank}</span>{" "}
                {entry.source === "ai"
                  ? "(AI-ranked)"
                  : entry.unassessed
                    ? "(not assessed by Jev: ordered by exact facts only)"
                    : entry.source === "probabilistic"
                      ? "(probabilistic estimate)"
                      : "(rule-based: AI ranking was unavailable this run)"}
              </p>
              <p className="mt-1">{entry.reasoning}</p>
              {entry.probabilistic && (
                <div className="mt-4 space-y-4">
                  <RankSummary detail={entry.probabilistic} />
                  <RankStrip probabilities={entry.probabilistic.rankProbabilities} className="max-w-xl" />
                  <TieNote detail={entry.probabilistic} workItemId={item.id} />
                  <details className="text-xs text-ink-3">
                    <summary className="cursor-pointer text-ink-2">Table view: chance of each rank</summary>
                    <table className="mt-2 font-mono">
                      <tbody>
                        {entry.probabilistic.rankProbabilities.map((p, i) => (
                          <tr key={i}>
                            <td className="pr-4">Rank {i + 1}</td>
                            <td>{(p * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </div>
              )}
            </>
          ) : (
            <p>Finished items are not ranked.</p>
          )}
        </Card>
      </section>

      {entry?.probabilistic && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink">What the estimate rests on</h2>
          <Card className="space-y-5 p-4">
            {rankingMode() === "demo" ? (
              <p className="rounded-lg border border-amber/50 p-3 text-xs text-amber">
                Demo mode: these level probabilities are invented by a local stand-in, not by Jev.
              </p>
            ) : (
              <p className="text-xs text-ink-3">Model estimates from Jev, not calibrated on real outcomes.</p>
            )}
            <DimensionBreakdown {...LEVERAGE_TITLE} estimate={entry.probabilistic.leverage} />
            <DimensionBreakdown {...SLIP_RISK_TITLE} estimate={entry.probabilistic.slipRisk} />
            <p className="text-xs text-ink-3">
              Time pressure, overdue severity, confirmed releases, the re-plan flag and owner load are exact facts computed in code, not model
              judgments. Owner load is shown but carries no weight.
            </p>
          </Card>
        </section>
      )}

      {entry && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink">Your context</h2>
          <FeedbackForm workItemId={item.id} rank={entry.rank} history={feedbackHistory} />
        </section>
      )}

      {(item.scope || item.lastActivityNote) && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink">From the source</h2>
          <Card className="space-y-2 p-4 text-sm text-ink-2">
            {item.scope && <p><span className="text-ink-3">Scope: </span>{item.scope}</p>}
            {item.lastActivityNote && <p><span className="text-ink-3">Latest note: </span>&ldquo;{item.lastActivityNote}&rdquo;</p>}
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-block font-medium text-ink underline">
              Open in {item.source} →
            </a>
          </Card>
        </section>
      )}

      <GapNote title="Cost of delay">
        A weekly dollar figure is not shown. It needs a cost rate per person and tracked time for everyone involved; no connected source supplies them, so none is shown rather than guessed.
      </GapNote>
    </div>
  );
}
