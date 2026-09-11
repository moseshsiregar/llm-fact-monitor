"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Politician, LLMProvider } from "@prisma/client";

export function FilterBar({
  politicians,
  providers,
}: {
  politicians: Politician[];
  providers: LLMProvider[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <span className="font-medium text-slate-600">Filter:</span>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
        defaultValue={searchParams.get("politicianId") ?? ""}
        onChange={(e) => updateParam("politicianId", e.target.value)}
      >
        <option value="">All politicians</option>
        {politicians.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
        defaultValue={searchParams.get("providerId") ?? ""}
        onChange={(e) => updateParam("providerId", e.target.value)}
      >
        <option value="">All providers</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {(searchParams.get("politicianId") || searchParams.get("providerId")) && (
        <button
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("politicianId");
            params.delete("providerId");
            router.push(`/?${params.toString()}`);
          }}
          className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
