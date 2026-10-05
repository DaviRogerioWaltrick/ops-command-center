"use server";

import { revalidatePath } from "next/cache";
import { addConfirmedOverride } from "../dependency-overrides";

/**
 * Promotes an AI-inferred dependency edge to confirmed — the dependency-
 * graph equivalent of ranking feedback. Bound directly as a form action, so
 * no client component or fetch wiring is needed for the "Confirm this link"
 * button in priority-list.tsx / bottleneck-list.tsx.
 */
export async function confirmDependencyLink(formData: FormData): Promise<void> {
  const blockerId = String(formData.get("blockerId") ?? "");
  const blockedId = String(formData.get("blockedId") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!blockerId || !blockedId) return;

  await addConfirmedOverride(blockerId, blockedId, note);

  revalidatePath("/");
  revalidatePath("/bottlenecks");
  revalidatePath("/workload");
}
