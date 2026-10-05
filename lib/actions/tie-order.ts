"use server";

import { revalidatePath } from "next/cache";
import { placeFirstInGroup } from "../operator-order";
import { getOpsSnapshot } from "../snapshot";

/**
 * "Put this one first" for a tie group on the command view. The group is
 * re-derived on the server from the current ranking, never trusted from the
 * form: the posted item must be a member of a tie group, and the posted
 * group id must match that item's own group. Anything else records nothing.
 */
export async function placeFirstInTieGroup(formData: FormData): Promise<void> {
  const workItemId = String(formData.get("workItemId") ?? "");
  const tieGroup = String(formData.get("tieGroup") ?? "");
  if (!workItemId || !tieGroup) return;

  const { ranking } = await getOpsSnapshot();
  const entry = ranking.find((r) => r.workItemId === workItemId);
  if (!entry || entry.probabilistic?.tieGroup !== tieGroup) return;

  const members = ranking.filter((r) => r.probabilistic?.tieGroup === tieGroup).sort((a, b) => a.rank - b.rank);
  const placed = await placeFirstInGroup(workItemId, members.map((m) => m.workItemId));
  if (placed) revalidatePath("/", "layout");
}
