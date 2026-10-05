import Link from "next/link";
import { AxisReadoutCells } from "./axis-readout";
import { RagBadge } from "./ui/rag-badge";
import { itemHref } from "@/lib/routes";
import type { AxisReadout } from "@/lib/views";
import { RankStrip, RankSummary, TieNote } from "./rank-probability";
import type { ProbabilisticDetail, SeverityResult, WorkItem } from "@/lib/types";

/** One work item as a click-through row: the title opens the full record at /items/[id]. */
export function ItemRow({
  item,
  severity,
  rank,
  reasoning,
  axes,
  aiUnavailable,
  probabilistic,
  companyWide,
}: {
  item: WorkItem;
  severity: SeverityResult;
  rank?: number;
  reasoning?: string;
  axes?: AxisReadout;
  aiUnavailable?: boolean;
  probabilistic?: ProbabilisticDetail;
  /** True when `rank` is a position inside a department while `probabilistic` still describes the company-wide ranking. */
  companyWide?: boolean;
}) {
  return (
    <div className="py-4">
      {/* Below the sm breakpoint the status badge stacks above the title, so the text gets the full width; wider screens keep it on the right. */}
      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {rank != null && <span className="text-xs font-semibold text-ink-3">#{rank}</span>}
            <Link href={itemHref(item.id)} className="font-medium text-ink hover:underline">
              {item.title}
            </Link>
          </div>
          <div className="mt-0.5 text-xs text-ink-3">
            <span className="capitalize">{item.source}</span>
            {item.assignee && <> · {item.assignee.name}</>}
            {item.team && <> · {item.team}</>}
          </div>
          {probabilistic && (
            <div className="mt-2 max-w-xl">
              <RankSummary detail={probabilistic} companyWide={companyWide} />
              <RankStrip probabilities={probabilistic.rankProbabilities} className="mt-2" />
              <TieNote detail={probabilistic} workItemId={item.id} />
            </div>
          )}
          {reasoning && <p className="mt-1.5 text-sm text-ink-2">{reasoning}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aiUnavailable && (
            <span className="text-[10px] uppercase tracking-wide text-ink-3" title="AI ranking unavailable this run; rule-based order shown instead.">
              rules
            </span>
          )}
          <RagBadge level={severity.level} label={severity.level === "green" ? undefined : severity.reason} />
        </div>
      </div>
      {axes && (
        <div className="mt-3">
          <AxisReadoutCells axes={axes} />
        </div>
      )}
    </div>
  );
}
