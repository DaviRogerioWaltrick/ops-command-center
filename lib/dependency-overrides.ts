import "server-only";
import type { DependencyEdge } from "./types";

interface StoredOverride {
  blockerId: string;
  blockedId: string;
  note: string;
  confirmedAt: number;
}

/**
 * Process-memory stand-in for the `dependencyOverrides` table in
 * lib/db/schema.ts — resets on server restart and doesn't survive multiple
 * serverless instances. This is deliberately temporary scaffolding: the
 * interaction it supports (an operator confirming an AI-inferred link, especially a
 * cross-source one that can never arrive as "confirmed" from any single
 * connector's own API) is real and works today; only the storage backend
 * changes once a database is provisioned — see BACKLOG.md, gated behind the
 * development phase.
 */
const overrides: StoredOverride[] = [];

/** Every promoted link, as confirmed DependencyEdges ready to merge into the graph. */
export async function listConfirmedOverrides(): Promise<DependencyEdge[]> {
  return overrides.map((o) => ({
    blockerId: o.blockerId,
    blockedId: o.blockedId,
    confidence: "confirmed" as const,
    note: o.note,
  }));
}

/** Idempotent — confirming the same pair twice is a no-op, not a duplicate. */
export async function addConfirmedOverride(blockerId: string, blockedId: string, note: string): Promise<void> {
  if (overrides.some((o) => o.blockerId === blockerId && o.blockedId === blockedId)) return;
  overrides.push({ blockerId, blockedId, note, confirmedAt: Date.now() });
}
