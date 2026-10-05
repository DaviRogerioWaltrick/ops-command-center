/**
 * Schema-as-code for the persistence layer this project needs but does not
 * yet have wired up. Nothing in this file connects to a database — see
 * lib/db/client.ts and the README's "Development phase" section. Writing
 * this now (without provisioning anything) is deliberate: schema design can
 * proceed ahead of any paid infrastructure decision, per the project's own
 * sequencing.
 *
 * These tables are what turn lib/workload.ts's live, in-memory snapshot into
 * an actual trend: a cron writes one `workloadSnapshots` row per person per
 * day, and "is this person's on-time delivery improving" becomes a query
 * instead of an impossibility.
 */
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

export const people = pgTable("people", {
  id: text("id").primaryKey(), // canonical id, e.g. "clickup:cu-p-1"
  name: text("name").notNull(),
  email: text("email"),
  sourceRefs: jsonb("source_refs").notNull(), // SourceRef[]
  // Sensitive — see MANIFESTO.md's governance note. Only ever read inside a
  // computed aggregate (cost-of-delay, budget burn); never rendered raw.
  costRatePerHour: real("cost_rate_per_hour"),
});

export const workItems = pgTable(
  "work_items",
  {
    id: text("id").primaryKey(), // canonical id, e.g. "salesforce:sf-201"
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    isDone: boolean("is_done").notNull(),
    // "delivered" | "abandoned" | null (open, or the source does not distinguish). See WorkItem.outcome.
    outcome: text("outcome"),
    assigneeId: text("assignee_id").references(() => people.id),
    parentId: text("parent_id"),
    parentTitle: text("parent_title"),
    scope: text("scope"),
    team: text("team"),
    url: text("url").notNull(),
    dueDateMs: timestamp("due_date", { mode: "date" }),
    createdMs: timestamp("created_at", { mode: "date" }),
    closedMs: timestamp("closed_at", { mode: "date" }),
    updatedMs: timestamp("updated_at", { mode: "date" }),
    lastActivityNote: text("last_activity_note"),
    // Required for the "how long does this normally take" comparison — see
    // MANIFESTO.md. Null (not 0) means the source has no time tracking
    // configured; the app must show that as a data gap, never a guess.
    category: text("category"),
    timeTrackedMs: integer("time_tracked_ms"),
    estimatedDurationMs: integer("estimated_duration_ms"),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("work_items_assignee_idx").on(table.assigneeId),
    index("work_items_source_idx").on(table.source),
    index("work_items_category_idx").on(table.category),
  ],
);

export const dependencyEdges = pgTable("dependency_edges", {
  id: text("id").primaryKey(), // `${blockerId}->${blockedId}`
  blockerId: text("blocker_id")
    .notNull()
    .references(() => workItems.id),
  blockedId: text("blocked_id")
    .notNull()
    .references(() => workItems.id),
  confidence: text("confidence").notNull(), // "confirmed" | "inferred"
  note: text("note"),
});

/**
 * An operator-verified promotion of an AI-inferred edge to confirmed — most
 * valuable for cross-source edges, which can never arrive as "confirmed"
 * from any single connector's own API (see COMPETITIVE_ANALYSIS.md). The
 * running app's real behavior today is `lib/dependency-overrides.ts`'s
 * process-memory version of exactly this table; swapping the backend to
 * this one is the only change needed once a database is provisioned.
 */
export const dependencyOverrides = pgTable("dependency_overrides", {
  id: text("id").primaryKey(), // `${blockerId}->${blockedId}`
  blockerId: text("blocker_id")
    .notNull()
    .references(() => workItems.id),
  blockedId: text("blocked_id")
    .notNull()
    .references(() => workItems.id),
  note: text("note").notNull(),
  confirmedAt: timestamp("confirmed_at", { mode: "date" }).notNull().defaultNow(),
});

export const workloadSnapshots = pgTable(
  "workload_snapshots",
  {
    id: text("id").primaryKey(), // `${personId}@${capturedAt.toISOString()}`
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    capturedAt: timestamp("captured_at", { mode: "date" }).notNull(),
    openCount: integer("open_count").notNull(),
    overdueCount: integer("overdue_count").notNull(),
    closedLast7d: integer("closed_last_7d").notNull(),
    blockingOthersCount: integer("blocking_others_count").notNull(),
  },
  (table) => [index("workload_snapshots_person_idx").on(table.personId, table.capturedAt)],
);

export const priorityRankings = pgTable(
  "priority_rankings",
  {
    id: text("id").primaryKey(), // `${runId}:${workItemId}`
    runId: text("run_id").notNull(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItems.id),
    rank: integer("rank").notNull(),
    score: real("score").notNull(),
    reasoning: text("reasoning").notNull(),
    releasesWorkFor: jsonb("releases_work_for").notNull(), // string[] of person ids
    source: text("source").notNull(), // "ai" | "rule-based"
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("priority_rankings_run_idx").on(table.runId)],
);

/**
 * The operator's own judgment on a ranking, captured in their words — the substrate
 * for MANIFESTO.md's "options, not verdicts" principle. The AI's ranking is
 * a starting hypothesis; this table is where the operator's correction or confirmation
 * of it accumulates, so a future ranking run can be given their past reasoning
 * as context instead of re-deriving the same read from scratch every time.
 * Nothing reads this table yet — writing it is the first step once real
 * rankings exist to react to.
 */
export const rankingFeedback = pgTable(
  "ranking_feedback",
  {
    id: text("id").primaryKey(),
    priorityRankingId: text("priority_ranking_id")
      .notNull()
      .references(() => priorityRankings.id),
    verdict: text("verdict").notNull(), // "agree" | "rank_should_differ"
    context: text("context"), // the operator's own free-text explanation
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("ranking_feedback_ranking_idx").on(table.priorityRankingId)],
);
