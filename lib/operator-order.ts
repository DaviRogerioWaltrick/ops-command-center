import "server-only";
import { memberKey } from "./ranking/probabilistic";

/**
 * The operator's own order for items the probabilistic ranking calls tied.
 * Process memory, the same stand-in pattern as ranking-feedback.ts and
 * dependency-overrides.ts: it resets on restart until a database exists.
 *
 * Each decision lists one tie group's exact members, earliest first, and
 * applies only to a tie group with exactly those members (see
 * applyOperatorOrder). Tie groups change between ranking passes, so a
 * decision about one set of items is never reused for a different set;
 * decisions for groups that no longer exist are harmless and ignored.
 */
let decisions: string[][] = [];

export async function getOperatorOrder(): Promise<string[][]> {
  return decisions.map((decision) => [...decision]);
}

/**
 * Puts `itemId` first among `groupIds` and records the others behind it in
 * the order they were shown, so one click decides the whole group. Choosing
 * again replaces the earlier decision for the same members. Rejects an item
 * not in the group.
 */
export async function placeFirstInGroup(itemId: string, groupIds: string[]): Promise<boolean> {
  if (!groupIds.includes(itemId)) return false;
  const key = memberKey(groupIds);
  const rest = groupIds.filter((id) => id !== itemId);
  decisions = [...decisions.filter((decision) => memberKey(decision) !== key), [itemId, ...rest]];
  return true;
}

/** Test helper: the store is module state. */
export function clearOperatorOrderForTests(): void {
  decisions = [];
}
