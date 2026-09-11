"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { DashboardDataOrigin } from "@/lib/dashboard/getDashboardData";

const OPTIONS: { value: DashboardDataOrigin; label: string; description: string }[] = [
  {
    value: "REAL",
    label: "Real",
    description: "Genuine API-backed observations only.",
  },
  {
    value: "MOCK",
    label: "Mock",
    description: "Seeded/synthetic observations only.",
  },
  {
    value: "ALL",
    label: "All (dev only)",
    description: "Combines real and synthetic observations for development inspection.",
  },
];

const CONTAMINATION_WARNING =
  "This view combines real and synthetic observations and should not be used for research inference.";

export function DataOriginToggle({ activeDataOrigin }: { activeDataOrigin: DashboardDataOrigin }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setDataOrigin(dataOrigin: DashboardDataOrigin) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("dataOrigin", dataOrigin);
    router.push(`/?${params.toString()}`);
  }

  const active = OPTIONS.find((o) => o.value === activeDataOrigin) ?? OPTIONS[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-white p-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setDataOrigin(o.value)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              o.value === activeDataOrigin
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-600">{active.description}</p>
      {activeDataOrigin === "ALL" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {CONTAMINATION_WARNING}
        </p>
      )}
    </div>
  );
}
