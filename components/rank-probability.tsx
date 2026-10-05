import { placeFirstInTieGroup } from "@/lib/actions/tie-order";
import { cn } from "@/lib/utils";
import type { ProbabilisticDetail } from "@/lib/types";

const percent = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Chance of each rank as a column strip: one series colour, 2px gaps, a 2px
 * rounded data end anchored to the baseline, the axis fixed at 0 to 100% so
 * strips are comparable between items. Every column has a hover title and the
 * whole strip has a text alternative; the numbers are also in RankSummary and
 * in the item page's table view, so nothing depends on colour or hover.
 */
export function RankStrip({ probabilities, className }: { probabilities: number[]; className?: string }) {
  const summary = probabilities
    .map((p, i) => ({ rank: i + 1, p }))
    .filter(({ p }) => p >= 0.005)
    .map(({ rank, p }) => `rank ${rank} ${percent(p)}`)
    .join(", ");
  return (
    <div className={className}>
      <div role="img" aria-label={`Chance of each rank: ${summary}`} className="flex h-8 items-end gap-0.5 border-b border-line">
        {probabilities.map((p, i) => (
          <div key={i} className="flex h-full flex-1 items-end" title={`Rank ${i + 1}: ${percent(p)}`}>
            {p >= 0.005 && <div className="w-full rounded-t-sm bg-series" style={{ height: `max(2px, ${p * 100}%)` }} />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-3" aria-hidden>
        <span>#1</span>
        <span>#{probabilities.length}</span>
      </div>
    </div>
  );
}

export function ConfidenceReadout({ value }: { value: number }) {
  return (
    <span
      className="font-mono text-xs text-ink-3"
      title="TypeSafe's measure of how concentrated the model's answers are (1 = all on one level). It is not the probability that the model is right."
    >
      confidence {value.toFixed(2)}
    </span>
  );
}

/** "Expected #3.2 · 41% chance of #1 · 78% in top 3", plus confidence. Plain text, so it stands without the strip. In a department list the numbers are still company-wide, so `companyWide` says so. */
export function RankSummary({ detail, companyWide = false }: { detail: ProbabilisticDetail; companyWide?: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-ink">
      <span className="font-medium">
        {companyWide ? "Company-wide expected" : "Expected"} #{detail.expectedRank.toFixed(1)}
      </span>
      <span className="text-ink-2">{percent(detail.pTop1)} chance of #1</span>
      <span className="text-ink-2">{percent(detail.pTop3)} in top 3</span>
      <ConfidenceReadout value={detail.confidence} />
    </p>
  );
}

/** Marks an item the ranking cannot separate from its neighbours. The choice of order is the operator's. */
export function TieNote({ detail, workItemId }: { detail: ProbabilisticDetail; workItemId: string }) {
  if (!detail.tieGroup) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
      <span className={cn("font-medium", detail.needsDecision ? "text-amber" : "text-ink-2")}>
        {detail.needsDecision ? "Tied: needs your call" : "Tied: your order"}
      </span>
      <form action={placeFirstInTieGroup}>
        <input type="hidden" name="workItemId" value={workItemId} />
        <input type="hidden" name="tieGroup" value={detail.tieGroup} />
        <button type="submit" className="rounded-md border border-line px-2 py-1 text-ink hover:bg-white/5">
          Put first in this tie
        </button>
      </form>
    </div>
  );
}
