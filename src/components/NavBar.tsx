"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/experiments/new", label: "New Experiment" },
  { href: "/experiments", label: "Experiments" },
  { href: "/history", label: "Run History" },
];

export function NavBar() {
  const pathname = usePathname();

  // Pick the single best (longest-prefix) match so e.g. "/experiments/new"
  // doesn't also light up the "Experiments" tab.
  const activeHref = [...NAV_ITEMS]
    .filter((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div>
          <Link href="/" className="text-lg font-semibold tracking-tight text-slate-900">
            LLM Fact Monitor
          </Link>
          <p className="text-xs text-slate-500">
            Research monitoring system &middot; fact discovery across LLM providers
          </p>
        </div>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
