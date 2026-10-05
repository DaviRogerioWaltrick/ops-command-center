import Link from "next/link";

/**
 * "Show top N" menu for the company-wide ranked list. A native details element, so it needs no client
 * script: each choice is a link that reloads the page with the new length (the page is rendered per request).
 */
export function TopLimitMenu({ current, options }: { current: number; options: { value: number; href: string }[] }) {
  return (
    <details className="relative text-xs">
      <summary className="cursor-pointer list-none rounded-full border border-line px-3 py-1 text-ink-2 hover:border-ink-3">
        Show top {current} <span aria-hidden="true">▾</span>
      </summary>
      <ul className="absolute right-0 z-10 mt-1 min-w-28 rounded-lg border border-line bg-surface p-1 shadow-lg">
        {options.map((option) => (
          <li key={option.value}>
            <Link
              href={option.href}
              aria-current={option.value === current ? "true" : undefined}
              className={option.value === current ? "block rounded-md bg-white/5 px-3 py-1.5 text-ink" : "block rounded-md px-3 py-1.5 text-ink-2 hover:bg-white/5"}
            >
              Top {option.value}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
