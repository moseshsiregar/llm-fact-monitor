import Link from "next/link";
import { getDashboardMatrix, getDashboardSummary } from "@/lib/dashboard/getDashboardData";
import type { DashboardDataOrigin } from "@/lib/dashboard/getDashboardData";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { ModeToggle } from "@/components/dashboard/ModeToggle";
import { DataOriginToggle } from "@/components/dashboard/DataOriginToggle";
import type { ExperimentMode } from "@prisma/client";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

const MODE_HEADING: Record<ExperimentMode, { title: string; subtitle: string }> = {
  TARGETED_RETRIEVAL: {
    title: "Targeted retrieval",
    subtitle:
      "Facts × LLM providers when prompts were directed toward each fact's topic. Each cell shows the most recent check; click for full evidence.",
  },
  OPEN_ENDED_DISCOVERY: {
    title: "Open-ended discovery",
    subtitle:
      "Facts × LLM providers when the model was only asked a broad question about the politician. A cell shows whether the fact surfaced spontaneously - the facts themselves were never sent to the model.",
  },
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ politicianId?: string; providerId?: string; mode?: string; dataOrigin?: string }>;
}) {
  const params = await searchParams;
  const mode: ExperimentMode = params.mode === "OPEN_ENDED_DISCOVERY" ? "OPEN_ENDED_DISCOVERY" : "TARGETED_RETRIEVAL";
  const dataOrigin: DashboardDataOrigin =
    params.dataOrigin === "MOCK" || params.dataOrigin === "ALL" ? params.dataOrigin : "REAL";
  const filters = {
    politicianId: params.politicianId,
    providerId: params.providerId,
    mode,
    dataOrigin,
  };
  const matrix = await getDashboardMatrix(filters);
  const summary = await getDashboardSummary(matrix, filters);
  const allPoliticians = await prisma.politician.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
  });
  const allProviders = await prisma.lLMProvider.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Facts × LLM providers, split by research mode. The same fact can have a different outcome
          in each mode.
        </p>
      </div>

      <ModeToggle activeMode={mode} />
      <DataOriginToggle activeDataOrigin={dataOrigin} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Total facts" value={String(summary.totalFacts)} hint={`${summary.totalPublishedFacts} published`} />
        <SummaryCard label="Experiment runs" value={String(summary.totalExperimentRuns)} />
        {summary.perProviderDiscoveryPercent.slice(0, 3).map((p) => (
          <SummaryCard key={p.providerId} label={`${p.providerName} discovery rate`} value={`${p.percent}%`} hint="of published facts" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Average time to first discovery
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {summary.perProviderAvgDaysToFirstDiscovery.map((p) => (
              <li key={p.providerId} className="flex justify-between">
                <span>{p.providerName}</span>
                <span className="font-medium">{p.avgDays !== null ? `${p.avgDays} days` : "no detections yet"}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Most frequently cited source categories
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {summary.topSourceCategories.length === 0 && (
              <li className="text-slate-400">No citations recorded yet.</li>
            )}
            {summary.topSourceCategories.map((c) => (
              <li key={c.label} className="flex justify-between">
                <span>{c.label.replace(/_/g, " ")}</span>
                <span className="font-medium">{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <FilterBar politicians={allPoliticians} providers={allProviders} />

      <div>
        <h2 className="text-lg font-semibold text-slate-900">{MODE_HEADING[mode].title}</h2>
        <p className="mt-1 text-sm text-slate-600">{MODE_HEADING[mode].subtitle}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="sticky left-0 z-10 min-w-[16rem] bg-slate-50 px-4 py-3 text-left font-medium text-slate-600">
                Fact
              </th>
              {matrix.providers.map((provider) => (
                <th key={provider.id} className="min-w-[8rem] px-3 py-3 text-center font-medium text-slate-600">
                  {provider.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.facts.length === 0 && (
              <tr>
                <td colSpan={matrix.providers.length + 1} className="px-4 py-6 text-center text-slate-400">
                  No facts match the current filters.
                </td>
              </tr>
            )}
            {matrix.facts.map((fact) => (
              <tr key={fact.id} className="border-b border-slate-100 last:border-0">
                <td className="sticky left-0 z-10 bg-white px-4 py-3 align-top">
                  <p className="font-medium text-slate-900">{fact.label}</p>
                  <p className="text-xs text-slate-500">{fact.politician.name}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {fact.status === "PRE_PUBLICATION"
                      ? `Pre-publication (planned ${formatDate(fact.publishedAt)})`
                      : `Published ${formatDate(fact.publishedAt)}`}
                  </p>
                </td>
                {matrix.providers.map((provider) => {
                  const cell = matrix.cells[fact.id]?.[provider.id];
                  return (
                    <td key={provider.id} className="px-3 py-3 text-center align-middle">
                      {cell ? (
                        <Link href={`/dashboard/${fact.id}/${provider.id}?mode=${mode}&dataOrigin=${dataOrigin}`} className="inline-block">
                          <StatusBadge
                            status={cell.latestStatus}
                            domain={cell.latestDisplayDomain}
                            semanticStatus={cell.latestSemanticStatus}
                            verificationError={cell.latestVerificationStatus === "ERROR"}
                            classifiedWithCurrentDetector={cell.latestClassifiedWithCurrentDetector}
                          />
                          {/* Phase 8 Section 12 - every repetition contributes to this
                              aggregate; the badge above only reflects the latest one. */}
                          <p className="mt-1 text-[10px] leading-tight text-slate-500">
                            {cell.observationCount > 0
                              ? `${cell.foundCount}/${cell.observationCount} FOUND · ${Math.round(cell.foundRate * 100)}%`
                              : cell.errorCount > 0
                                ? `${cell.errorCount} error${cell.errorCount === 1 ? "" : "s"}`
                                : null}
                          </p>
                          {/* Detector-versioning audit - disclose (never hide) when some
                              repetitions still only have a historical classification. */}
                          {cell.pendingReclassificationCount > 0 && (
                            <p className="mt-0.5 text-[10px] leading-tight text-slate-400">
                              {cell.pendingReclassificationCount} pending reclassification
                            </p>
                          )}
                        </Link>
                      ) : (
                        <StatusBadge status="NOT_FOUND" domain={null} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
