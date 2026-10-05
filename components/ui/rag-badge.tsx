import { cn } from "@/lib/utils";
import type { RagLevel } from "@/lib/types";

// Status always ships with its text label and a dot, never color alone.
const STYLES: Record<RagLevel, string> = {
  red: "bg-red/15 text-red",
  amber: "bg-amber/15 text-amber",
  green: "bg-green/15 text-green",
};

export function RagBadge({ level, label }: { level: RagLevel; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", STYLES[level])}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? level}
    </span>
  );
}
