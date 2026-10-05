import { confirmDependencyLink } from "@/lib/actions/dependencies";

/**
 * The dependency-graph equivalent of the ranking feedback loop: promotes a
 * single AI-inferred edge to confirmed. A plain server-action form — no
 * client component needed, works inside these server-rendered lists as-is.
 */
export function ConfirmLinkButton({ blockerId, blockedId, note }: { blockerId: string; blockedId: string; note: string }) {
  return (
    <form action={confirmDependencyLink} className="inline">
      <input type="hidden" name="blockerId" value={blockerId} />
      <input type="hidden" name="blockedId" value={blockedId} />
      <input type="hidden" name="note" value={note} />
      <button type="submit" className="font-medium text-accent-ink underline decoration-dotted">
        Confirm this link
      </button>
    </form>
  );
}
