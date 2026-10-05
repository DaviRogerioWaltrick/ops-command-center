import { cn } from "@/lib/utils";

/** A single headline number. `note` carries the honest qualifier (sample size, "no data") that keeps a number from over-claiming. */
export function Stat({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "default" | "red" | "amber";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="text-sm text-ink-2">{label}</div>
      <div
        className={cn(
          "mt-2 font-display text-3xl font-bold tracking-tight",
          tone === "red" && "text-red",
          tone === "amber" && "text-amber",
          tone === "default" && "text-ink",
        )}
      >
        {value}
      </div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}
