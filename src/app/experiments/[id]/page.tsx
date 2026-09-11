import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { selectAuthoritativeObservations } from "@/lib/detection/authoritativeDetection";

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-50 text-slate-500 border-slate-200",
  RUNNING: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
};

const MODE_LABEL: Record<string, string> = {
  TARGETED_RETRIEVAL: "Targeted retrieval",
  OPEN_ENDED_DISCOVERY: "Open-ended discovery",
};

const DATA_ORIGIN_STYLE: Record<string, string> = {
  REAL: "bg-violet-50 text-violet-700 border-violet-200",
  MOCK: "bg-slate-100 text-slate-500 border-slate-200",
};

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: {
      politician: true,
      facts: { include: { fact: true } },
      prompts: { include: { prompt: true } },
      providers: { include: { provider: true } },
      runs: { include: { provider: true, prompt: true }, orderBy: { startedAt: "asc" } },
    },
  });

  if (!experiment) notFound();

  const expectedCalls = experiment.providers.length * experiment.repetitions * experiment.prompts.length;
  const promptText = experiment.prompts[0]?.prompt.text ?? "(no prompt)";
  const totalProviderCost = experiment.runs.reduce((sum, r) => sum + (r.providerCost ?? 0), 0);
  const hasCostData = experiment.runs.some((r) => r.providerCost != null);

  const runIds = experiment.runs.map((r) => r.id);
  const detections = runIds.length
    ? await prisma.factDetection.findMany({
        where: { experimentRunId: { in: runIds } },
        orderBy: { detectedAt: "asc" },
      })
    : [];

  // Phase 8 Section 8 - semantic verification cost is tracked SEPARATELY
  // from provider retrieval cost, and never attributed to the tested
  // provider; the experiment total is the sum of both.
  const totalVerifierCost = detections.reduce((sum, d) => sum + (d.verifierCostUsd ?? 0), 0);
  const hasVerifierCostData = detections.some((d) => d.verifierCostUsd != null);
  const totalExperimentCost = totalProviderCost + totalVerifierCost;

  // Latest detection per (fact, provider) pair, restricted to this
  // experiment's own runs. Detector-versioning audit: a (run, fact) pair
  // can have more than one FactDetection row when it has been reprocessed
  // with a newer detector - collapse to exactly one authoritative row per
  // pair before picking the latest, so two detector versions are never
  // treated as two separate repetitions.
  const runProviderById = new Map(experiment.runs.map((r) => [r.id, r.providerId]));
  const runStartedAtById = new Map(experiment.runs.map((r) => [r.id, r.startedAt]));
  const observations = selectAuthoritativeObservations(detections);
  const matrix = new Map<string, (typeof detections)[number]>(); // `${factId}::${providerId}` -> latest observation
  const classifiedWithCurrentDetectorByKey = new Map<string, boolean>();
  const latestTimeByKey = new Map<string, number>();
  for (const o of observations) {
    const providerId = runProviderById.get(o.experimentRunId);
    if (!providerId) continue;
    const key = `${o.factId}::${providerId}`;
    const time = runStartedAtById.get(o.experimentRunId)?.getTime() ?? o.primary.detectedAt.getTime();
    const existingTime = latestTimeByKey.get(key);
    if (existingTime === undefined || time >= existingTime) {
      latestTimeByKey.set(key, time);
      matrix.set(key, o.primary);
      classifiedWithCurrentDetectorByKey.set(key, o.isCurrentDetectorVersion);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/experiments/new" className="text-sm text-slate-500 hover:underline">
          &larr; Configure another experiment
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
          {experiment.subjectName || experiment.politician.name}
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[experiment.status]}`}
          >
            {experiment.status}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${DATA_ORIGIN_STYLE[experiment.dataOrigin]}`}
          >
            {experiment.dataOrigin}
          </span>
        </h1>
        <p className="mt-1 text-sm font-medium uppercase tracking-wide text-slate-500">
          {MODE_LABEL[experiment.mode] ?? experiment.mode}
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Prompt</p>
        <p className="mt-1 text-sm text-slate-800">&ldquo;{promptText}&rdquo;</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Facts monitored" value={String(experiment.facts.length)} />
        <Stat label="Models" value={String(experiment.providers.length)} />
        <Stat label="Repetitions" value={String(experiment.repetitions)} />
        <Stat label="Expected API calls" value={String(expectedCalls)} />
        {hasCostData && <Stat label="Retrieval cost" value={formatCost(totalProviderCost)} />}
        {hasVerifierCostData && <Stat label="Semantic verification cost" value={formatCost(totalVerifierCost)} />}
        {(hasCostData || hasVerifierCostData) && (
          <Stat label="Total experiment cost" value={formatCost(totalExperimentCost)} />
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Configuration</p>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Facts monitored</dt>
            <dd className="mt-1 flex flex-col gap-0.5">
              {experiment.facts.map((f) => (
                <span key={f.id} className="text-slate-800">
                  {f.fact.canonicalFactText}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Models</dt>
            <dd className="mt-1 flex flex-col gap-0.5">
              {experiment.providers.map((p) => (
                <span key={p.id} className="text-slate-800">
                  {p.provider.name}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="min-w-[16rem] px-4 py-3 text-left font-medium text-slate-600">Fact</th>
              {experiment.providers.map((p) => (
                <th key={p.id} className="min-w-[7rem] px-3 py-3 text-center font-medium text-slate-600">
                  {p.provider.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {experiment.facts.map((f) => (
              <tr key={f.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 align-top text-slate-800">{f.fact.canonicalFactText}</td>
                {experiment.providers.map((p) => {
                  const key = `${f.factId}::${p.providerId}`;
                  const d = matrix.get(key);
                  return (
                    <td key={p.id} className="px-3 py-3 text-center align-middle">
                      <StatusBadge
                        status={(d?.status as "FOUND" | "NOT_FOUND" | "UNCERTAIN") ?? "NOT_FOUND"}
                        domain={null}
                        semanticStatus={d?.semanticStatus ?? null}
                        verificationError={d?.verificationStatus === "ERROR"}
                        classifiedWithCurrentDetector={classifiedWithCurrentDetectorByKey.get(key) ?? true}
                        compact
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Individual runs ({experiment.runs.length})</h2>
        <Link
          href={`/?politicianId=${experiment.politicianId}&mode=${experiment.mode}`}
          className="text-sm font-medium text-slate-700 underline"
        >
          View in dashboard &rarr;
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Timestamp</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Prompt</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Provider</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Repetition</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {experiment.runs.map((run) => (
              <tr key={run.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">
                  <Link href={`/history/${run.id}`} className="underline">
                    {formatDateTime(run.startedAt)}
                  </Link>
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-slate-900">{run.prompt.text}</td>
                <td className="px-4 py-3 text-slate-600">{run.provider.name}</td>
                <td className="px-4 py-3 text-slate-600">{run.repetitionIndex + 1}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      run.status === "SUCCESS"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : run.status === "ERROR"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                  >
                    {run.status}
                  </span>
                </td>
              </tr>
            ))}
            {experiment.runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No runs recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}
