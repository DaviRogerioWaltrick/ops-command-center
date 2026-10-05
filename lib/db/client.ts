import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Not called anywhere yet. Lazy on purpose (per Neon/Next build-time
 * guidance): a top-level `neon()` call would throw during `next build`
 * before DATABASE_URL exists. This whole file is groundwork — no database is
 * provisioned until the operator explicitly starts the development phase (see
 * README). When it is, the first real caller is a cron job that persists
 * lib/workload.ts's live snapshot into `workloadSnapshots` on a schedule.
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set — no database has been provisioned yet. See README's 'Development phase' section.",
      );
    }
    const sql = neon(url);
    _db = drizzle(sql, { schema });
  }
  return _db;
}
