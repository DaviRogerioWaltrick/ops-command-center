import type { AxisReadout } from "@/lib/views";

/**
 * Time / resource / scope, as text. A triangle would need a numeric scale per
 * axis, and a scale here would be invented (design rule: show only the axes
 * the data supports). Resource says "no
 * data" until a source supplies tracked and estimated time.
 */
export function AxisReadoutCells({ axes }: { axes: AxisReadout }) {
  const cells: { label: string; value: string | null }[] = [
    { label: "Time", value: axes.time },
    { label: "Resource", value: axes.resource },
    { label: "Scope", value: axes.scope },
  ];
  return (
    <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
      {cells.map((cell) => (
        <div key={cell.label}>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{cell.label}</dt>
          <dd className={cell.value ? "mt-0.5 text-ink-2" : "mt-0.5 italic text-ink-3"}>{cell.value ?? "No data"}</dd>
        </div>
      ))}
    </dl>
  );
}
