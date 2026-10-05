import Link from "next/link";
import { cn } from "@/lib/utils";
import { departmentHref } from "@/lib/routes";
import type { DepartmentRow } from "@/lib/views";

/**
 * Open work per department as a two-segment bar: open-and-not-late (series
 * blue) and late (status red), 2px surface gap between them, 4px rounded
 * data end, 8px thick. Counts are the labels, so nothing depends on colour or
 * a tooltip. Each row links to the department record.
 */
export function DepartmentBars({ rows, activeTeam }: { rows: DepartmentRow[]; activeTeam: string | null }) {
  const max = Math.max(1, ...rows.map((r) => r.open));
  return (
    <div>
      <div className="flex gap-4 px-4 pt-3 text-xs text-ink-2" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-series" />Open, not late</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red" />Late</span>
      </div>
      <div className="divide-y divide-line px-4">
        {rows.map((row) => {
          const onTrack = row.open - row.overdue;
          return (
            <Link
              key={row.team}
              href={departmentHref(row.team)}
              title={`${row.team}: ${row.open} open, ${row.overdue} late`}
              className={cn("flex items-center gap-4 py-3 hover:bg-white/5", activeTeam && activeTeam !== row.team && "opacity-50")}
            >
              <span className="w-28 shrink-0 text-sm text-ink-2 sm:w-36">{row.team}</span>
              <span className="flex h-2 flex-1 gap-0.5">
                {onTrack > 0 && (
                  <span
                    className={cn("h-full bg-series rounded-l-sm", row.overdue === 0 && "rounded-r")}
                    style={{ width: `${(onTrack / max) * 100}%` }}
                  />
                )}
                {row.overdue > 0 && (
                  <span
                    className={cn("h-full bg-red rounded-r", onTrack === 0 && "rounded-l-sm")}
                    style={{ width: `${(row.overdue / max) * 100}%` }}
                  />
                )}
              </span>
              <span className="shrink-0 whitespace-nowrap text-right font-mono text-xs text-ink-2 sm:w-28">
                {row.open} open · {row.overdue} late
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
