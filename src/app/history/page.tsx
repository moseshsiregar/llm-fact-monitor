import Link from "next/link";
import { prisma } from "@/lib/prisma";
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
  SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
  PENDING: "bg-slate-50 text-slate-500 border-slate-200",
  RUNNING: "bg-blue-50 text-blue-700 border-blue-200",
};

const MODE_LABEL: Record<string, string> = {
  TARGETED_RETRIEVAL: "Targeted",
  OPEN_ENDED_DISCOVERY: "Open-ended",
};

export default async function HistoryPage() {
  const runs = await prisma.experimentRun.findMany({
    include: {
      provider: true,
      prompt: { include: { politician: true } },
      _count: { select: { citations: true } },
      detections: { select: { id: true, experimentRunId: true, factId: true, detectorVersion: true, detectedAt: true, status: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Run history</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every experiment run recorded, most recent first. Click a run to inspect the full prompt,
          answer, citations and detections.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Timestamp</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Politician</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Prompt</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Provider</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Mode</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Facts found</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Citations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((run) => {
              // Detector-versioning audit: collapse to one observation per
              // monitored fact before counting - a fact reprocessed with a
              // newer detector must never be counted (or divided by) twice.
              const observations = selectAuthoritativeObservations(run.detections);
              const factsFound = observations.filter((o) => o.primary.status === "FOUND").length;
              return (
                <tr key={run.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">
                    <Link href={`/history/${run.id}`} className="underline">
                      {formatDateTime(run.startedAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{run.prompt.politician.name}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-900">{run.prompt.text}</td>
                  <td className="px-4 py-3 text-slate-600">{run.provider.name}</td>
                  <td className="px-4 py-3 text-slate-600">{MODE_LABEL[run.mode] ?? run.mode}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[run.status]}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {factsFound} / {observations.length}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{run._count.citations}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
