"use server";

import { revalidatePath } from "next/cache";
import { addRankingFeedback, parseFeedbackForm } from "../ranking-feedback";
import { itemHref } from "../routes";
import { getOpsSnapshot } from "../snapshot";

/**
 * Records the operator's verdict on one item's ranking: "agree", or "rank
 * should differ" plus their own reasoning. Bound directly as a form action
 * in components/feedback-form.tsx, like confirmDependencyLink. The rank and
 * reasoning on screen are read from the cached snapshot and stored with the
 * verdict. An item that is not currently ranked (finished, or unknown id)
 * records nothing.
 */
export async function submitRankingFeedback(formData: FormData): Promise<void> {
  const parsed = parseFeedbackForm(formData);
  if (!parsed) return;

  const snapshot = await getOpsSnapshot();
  const entry = snapshot.ranking.find((r) => r.workItemId === parsed.workItemId);
  if (!entry) return;

  await addRankingFeedback({
    workItemId: parsed.workItemId,
    verdict: parsed.verdict,
    context: parsed.context,
    rankAtTime: entry.rank,
    rankSource: entry.source,
    reasoningAtTime: entry.reasoning,
  });

  revalidatePath(itemHref(parsed.workItemId));
}
