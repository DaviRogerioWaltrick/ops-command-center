import { Card } from "./ui/card";
import { submitRankingFeedback } from "@/lib/actions/feedback";
import { MAX_CONTEXT_LENGTH, type RankingFeedbackRecord } from "@/lib/ranking-feedback";

const VERDICT_LABEL = { agree: "Agreed", rank_should_differ: "Said the rank should differ" } as const;

const formatWhen = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The feedback loop: agree, or say the rank should differ
 * and why. A plain server-action form (no client component). Two honest
 * caveats are shown on the page itself: verdicts are kept in memory only for
 * now, and they do not change rankings yet.
 */
export function FeedbackForm({
  workItemId,
  rank,
  history,
}: {
  workItemId: string;
  rank: number;
  history: RankingFeedbackRecord[];
}) {
  return (
    <Card className="space-y-4 p-4">
      <form action={submitRankingFeedback} className="space-y-3">
        <input type="hidden" name="workItemId" value={workItemId} />
        <label htmlFor={`context-${workItemId}`} className="block text-sm text-ink-2">
          Agree with the ranking, or tell the model what it is missing.
        </label>
        <textarea
          id={`context-${workItemId}`}
          name="context"
          rows={3}
          maxLength={MAX_CONTEXT_LENGTH}
          placeholder="Optional. For example: Legal already said this slips another week whatever we do, so deprioritise until Thursday."
          className="w-full rounded-lg border border-line bg-bg p-3 text-sm text-ink placeholder:text-ink-3"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="verdict" value="agree" className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-white/5">
            Agree with #{rank}
          </button>
          <button type="submit" name="verdict" value="rank_should_differ" className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-white/5">
            Rank should differ
          </button>
        </div>
        <p className="text-xs text-ink-3">
          Saved in memory only for now, so it clears when the server restarts. It does not change rankings yet.
        </p>
      </form>

      {history.length > 0 && (
        <div className="border-t border-line pt-3">
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">Your earlier verdicts</h3>
          <ul className="space-y-2 text-sm">
            {history.slice(0, 5).map((record) => (
              <li key={record.id}>
                <span className="text-ink">{VERDICT_LABEL[record.verdict]}</span>
                <span className="text-ink-3">
                  {" "}
                  · {formatWhen(record.createdAtMs)} · it was #{record.rankAtTime}
                  {record.rankSource === "rule-based" ? " (rule-based)" : ""}
                </span>
                {record.context && <p className="mt-0.5 text-ink-2">&ldquo;{record.context}&rdquo;</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
