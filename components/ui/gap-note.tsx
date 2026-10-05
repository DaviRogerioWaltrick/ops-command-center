/** Shown where the design calls for a chart or figure the data cannot yet support. Never a placeholder number: it says what is missing. */
export function GapNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-3/40 p-4 text-sm">
      <div className="font-medium text-ink-2">{title}</div>
      <p className="mt-1 text-ink-3">{children}</p>
    </div>
  );
}
