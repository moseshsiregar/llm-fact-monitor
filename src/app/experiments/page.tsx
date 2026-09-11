import Link from "next/link";
import { prisma } from "@/lib/prisma";

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

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function ExperimentsPage() {
  const experiments = await prisma.experiment.findMany({
    include: { _count: { select: { runs: true, facts: true, providers: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Experiments</h1>
          <p className="mt-1 text-sm text-slate-600">Every experiment that has been configured and run.</p>
        </div>
        <Link href="/experiments/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          New experiment
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Created</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Subject</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Data</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Mode</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Facts</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Models</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Runs</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {experiments.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">
                  <Link href={`/experiments/${e.id}`} className="underline">
                    {formatDateTime(e.createdAt)}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">{e.subjectName || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${DATA_ORIGIN_STYLE[e.dataOrigin]}`}
                  >
                    {e.dataOrigin}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{MODE_LABEL[e.mode] ?? e.mode}</td>
                <td className="px-4 py-3 text-slate-600">{e._count.facts}</td>
                <td className="px-4 py-3 text-slate-600">{e._count.providers}</td>
                <td className="px-4 py-3 text-slate-600">{e._count.runs}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status]}`}>
                    {e.status}
                  </span>
                </td>
              </tr>
            ))}
            {experiments.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                  No experiments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
