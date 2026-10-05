import Link from "next/link";

export function Nav() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="font-display text-lg font-bold tracking-tight text-ink">
          ops-command-center
        </Link>
        <span className="hidden text-sm text-ink-3 sm:inline">Operations control panel</span>
      </div>
    </header>
  );
}
