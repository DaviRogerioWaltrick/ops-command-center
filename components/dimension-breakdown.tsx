import { LEVEL_LABELS } from "@/lib/ranking/probabilistic";
import type { DimensionEstimate } from "@/lib/types";
import { ConfidenceReadout } from "./rank-probability";

const percent = (p: number) => `${Math.round(p * 100)}%`;

/** One Jev judgment as a probability for each level, labelled with the level's meaning. Text carries every value. */
export function DimensionBreakdown({
  title,
  question,
  labels,
  estimate,
}: {
  title: string;
  question: string;
  labels: readonly string[];
  estimate: DimensionEstimate;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <ConfidenceReadout value={estimate.confidence} />
      </div>
      <p className="mt-0.5 text-xs text-ink-3">{question}</p>
      <ul className="mt-2 space-y-1.5">
        {estimate.probabilities.map((p, level) => (
          <li key={level} className="flex items-center gap-3 text-xs">
            <span className="w-36 shrink-0 text-ink-2 sm:w-44">
              {level} · {labels[level]}
            </span>
            <span className="flex h-2 flex-1">
              {p >= 0.005 && <span className="h-full rounded-r-sm bg-series" style={{ width: `${p * 100}%` }} />}
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-ink-2">{percent(p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const LEVERAGE_TITLE = { title: "Leverage", question: "How much finishing this unblocks other people or changes what the organization can do.", labels: LEVEL_LABELS.leverage };
export const SLIP_RISK_TITLE = { title: "Slip risk", question: "Whether the latest note and scope show it is stalled or at real risk, or merely old.", labels: LEVEL_LABELS.slipRisk };
