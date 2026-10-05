import "server-only";

/**
 * Process-memory stand-in for the `rankingFeedback` table in lib/db/schema.ts,
 * the same pattern as dependency-overrides.ts: the interaction is real, only
 * the storage backend changes once a database exists. It resets on server
 * restart, and in development a code change can reset it too.
 *
 * The real table points at a persisted ranking run (`priorityRankingId`), and
 * rankings are not persisted yet. Until they are, each record carries the rank
 * and reasoning that were on screen when the verdict was given, so a record
 * stays interpretable even after the model re-ranks. When rankings persist,
 * those three fields collapse into the run id.
 *
 * Nothing reads this back into the ranking prompt yet; that read path is a
 * separate backlog item and needs real ranking history first.
 */
export type FeedbackVerdict = "agree" | "rank_should_differ";

export interface RankingFeedbackRecord {
  id: string;
  workItemId: string;
  verdict: FeedbackVerdict;
  /** The operator's own free-text reasoning. Optional. */
  context: string | null;
  rankAtTime: number;
  rankSource: "ai" | "rule-based" | "probabilistic";
  reasoningAtTime: string;
  createdAtMs: number;
}

export const MAX_CONTEXT_LENGTH = 2000;

const records: RankingFeedbackRecord[] = [];

export interface ParsedFeedbackForm {
  workItemId: string;
  verdict: FeedbackVerdict;
  context: string | null;
}

/** Validates the submitted form. Returns null for anything malformed, so a forged or partial post records nothing. */
export function parseFeedbackForm(formData: FormData): ParsedFeedbackForm | null {
  const workItemId = String(formData.get("workItemId") ?? "").trim();
  const verdict = String(formData.get("verdict") ?? "");
  if (!workItemId || (verdict !== "agree" && verdict !== "rank_should_differ")) return null;
  const context = String(formData.get("context") ?? "").trim().slice(0, MAX_CONTEXT_LENGTH);
  return { workItemId, verdict, context: context || null };
}

export async function addRankingFeedback(input: Omit<RankingFeedbackRecord, "id" | "createdAtMs">): Promise<RankingFeedbackRecord> {
  const record: RankingFeedbackRecord = { ...input, id: crypto.randomUUID(), createdAtMs: Date.now() };
  records.push(record);
  return record;
}

/** Newest first. */
export async function listFeedbackForItem(workItemId: string): Promise<RankingFeedbackRecord[]> {
  return records.filter((r) => r.workItemId === workItemId).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** Test helper: the store is module state. */
export function clearRankingFeedbackForTests(): void {
  records.length = 0;
}
