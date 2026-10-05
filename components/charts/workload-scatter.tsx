import Link from "next/link";
import { personHref } from "@/lib/routes";
import type { PersonRow } from "@/lib/views";

const W = 520;
const H = 270;
const M = { left: 44, right: 28, top: 18, bottom: 40 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const LABEL_LIMIT = 6;

/**
 * Workload versus on-time delivery, one dot per person. One series, so one
 * colour; size is how many of their open items block someone else's work.
 * Only people with delivered items carrying both a due and a close date have
 * an on-time rate, so only they are plotted; the rest are listed beneath the
 * chart rather than placed at an invented value. Each dot has a 24px-minimum
 * transparent hit area, is a keyboard-focusable link, and shows the same
 * tooltip on hover and focus. The people table next to it is the table view.
 */
export function WorkloadScatter({ rows }: { rows: PersonRow[] }) {
  const plotted = rows.filter((r) => r.onTime.rate != null);
  const unplotted = rows.filter((r) => r.onTime.rate == null);
  const xMax = Math.max(5, Math.ceil(Math.max(0, ...plotted.map((r) => r.open)) / 5) * 5);
  const x = (open: number) => M.left + (open / xMax) * PLOT_W;
  const y = (rate: number) => M.top + (1 - rate) * PLOT_H;
  const labelled = new Set([...plotted].sort((a, b) => b.open - a.open).slice(0, LABEL_LIMIT).map((r) => r.person.id));

  return (
    <div>
      {plotted.length === 0 ? (
        <p className="p-4 text-sm text-ink-3">
          No one has delivered items with both a due date and a close date yet, so there is nothing to plot. Nobody is placed at an assumed value.
        </p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-xl" role="group" aria-label="Open items versus on-time rate, one dot per person">
          {[0, 0.5, 1].map((tick) => (
            <g key={tick}>
              <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={M.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-3)">
                {Math.round(tick * 100)}%
              </text>
            </g>
          ))}
          {Array.from({ length: xMax / 5 + 1 }, (_, i) => i * 5).map((tick) => (
            <text key={tick} x={x(tick)} y={H - M.bottom + 16} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
              {tick}
            </text>
          ))}
          <text x={M.left + PLOT_W / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--color-ink-2)">
            Open items
          </text>
          <text x={12} y={M.top + PLOT_H / 2} textAnchor="middle" fontSize={11} fill="var(--color-ink-2)" transform={`rotate(-90 12 ${M.top + PLOT_H / 2})`}>
            On-time rate
          </text>

          {plotted.map((row) => {
            const cx = x(row.open);
            const cy = y(row.onTime.rate!);
            const r = 6 + Math.min(row.blockingOthers, 4) * 2;
            const flip = cx > W / 2;
            const tipW = 176;
            const tipX = flip ? cx - r - 8 - tipW : cx + r + 8;
            const tipY = Math.min(Math.max(cy - 28, M.top), H - M.bottom - 62);
            return (
              <Link key={row.person.id} href={personHref(row.person.id)} aria-label={`${row.person.name}: ${row.open} open, on time ${Math.round(row.onTime.rate! * 100)}% of ${row.onTime.sample}`}>
                <g className="group cursor-pointer outline-none">
                  <circle cx={cx} cy={cy} r={Math.max(r + 6, 14)} fill="transparent" />
                  <circle cx={cx} cy={cy} r={r} fill="var(--color-series)" fillOpacity={0.9} stroke="var(--color-surface)" strokeWidth={2} className="group-hover:stroke-ink group-focus-visible:stroke-ink" />
                  {labelled.has(row.person.id) && (
                    <text x={cx} y={cy + r + 14} textAnchor="middle" fontSize={11} fill="var(--color-ink-2)" className="group-hover:opacity-0">
                      {row.person.name}
                    </text>
                  )}
                  <g className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <rect x={tipX} y={tipY} width={tipW} height={58} rx={6} fill="var(--color-bg)" stroke="var(--color-line)" />
                    <text x={tipX + 10} y={tipY + 18} fontSize={12} fontWeight={600} fill="var(--color-ink)">{row.person.name}</text>
                    <text x={tipX + 10} y={tipY + 35} fontSize={11} fill="var(--color-ink-2)">
                      {row.open} open · {row.overdue} late · {row.blockingOthers} blocking
                    </text>
                    <text x={tipX + 10} y={tipY + 50} fontSize={11} fill="var(--color-ink-2)">
                      On time {Math.round(row.onTime.rate! * 100)}% (n={row.onTime.sample})
                    </text>
                  </g>
                </g>
              </Link>
            );
          })}
        </svg>
      )}
      <p className="px-4 pb-3 text-xs text-ink-3">
        Dot size: items blocking others. {unplotted.length > 0 && <>Not plotted, no on-time history: {unplotted.map((r) => r.person.name).join(", ")}.</>}
      </p>
    </div>
  );
}
