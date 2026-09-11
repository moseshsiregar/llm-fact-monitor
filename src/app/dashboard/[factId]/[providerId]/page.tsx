import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import type { DashboardDataOrigin } from "@/lib/dashboard/getDashboardData";
import type { ExperimentMode } from "@prisma/client";
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

const SOURCE_RELATIONSHIP_LABEL: Record<string, string> = {
  ORIGINAL_SOURCE: "Original source (cited somewhere in the response)",
  DOWNSTREAM_OR_DIFFERENT_SOURCE: "Downstream / different source",
  UNKNOWN_SOURCE: "Unknown source",
  SOURCE_NOT_SPECIFIED: "Original source not specified",
  NOT_APPLICABLE: "Not applicable",
};

const MODE_LABEL: Record<ExperimentMode, string> = {
  TARGETED_RETRIEVAL: "Targeted retrieval",
  OPEN_ENDED_DISCOVERY: "Open-ended discovery",
};

const DATA_ORIGIN_STYLE: Record<string, string> = {
  REAL: "bg-violet-50 text-violet-700 border-violet-200",
  MOCK: "bg-slate-100 text-slate-500 border-slate-200",
};

function displayDomain(
  sourceRelationship: string,
  responseCitationDomains: string[],
  originalDomain: string | null
): string | null {
  if (sourceRelationship === "ORIGINAL_SOURCE" && originalDomain) return originalDomain;
  return responseCitationDomains[0] ?? null;
}

export default async function CellDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ factId: string; providerId: string }>;
  searchParams: Promise<{ mode?: string; dataOrigin?: string }>;
}) {
  const { factId, providerId } = await params;
  const { mode: modeParam, dataOrigin: dataOriginParam } = await searchParams;
  const mode: ExperimentMode = modeParam === "OPEN_ENDED_DISCOVERY" ? "OPEN_ENDED_DISCOVERY" : "TARGETED_RETRIEVAL";
  const dataOrigin: DashboardDataOrigin =
    dataOriginParam === "MOCK" || dataOriginParam === "ALL" ? dataOriginParam : "REAL";

  const fact = await prisma.fact.findUnique({
    where: { id: factId },
    include: { politician: true },
  });
  const provider = await prisma.lLMProvider.findUnique({ where: { id: providerId } });

  if (!fact || !provider) notFound();

  const detections = await prisma.factDetection.findMany({
    where: {
      factId,
      // `experimentRun` is a to-one relation on FactDetection - Prisma
      // requires the `is` relation predicate here (a bare object is only
      // valid for to-many relations, which use some/every/none).
      experimentRun: {
        is: {
          providerId,
          mode,
          ...(dataOrigin === "ALL" ? {} : { dataOrigin }),
        },
      },
    },
    include: {
      experimentRun: {
        include: {
          prompt: true,
          citations: true,
          detections: { include: { fact: true } },
        },
      },
    },
    orderBy: { detectedAt: "desc" },
  });

  // Detector-versioning audit: a (experimentRun, fact) pair can have more
  // than one FactDetection row when it has been reprocessed with a newer
  // detector - collapse to exactly one authoritative "current" row per run
  // before computing stats/history, so two detector versions are never
  // treated as two separate checks/repetitions. Historical rows remain
  // available per-observation for evidence display only.
  const observations = selectAuthoritativeObservations(detections);
  const sortedObservations = [...observations].sort(
    (a, b) => a.primary.experimentRun.startedAt.getTime() - b.primary.experimentRun.startedAt.getTime()
  );
  const primaryRows = sortedObservations.map((o) => o.primary);
  const firstChecked = sortedObservations[0]?.primary;
  const firstDetected = primaryRows.find((d) => d.status === "FOUND");
  const totalDetections = primaryRows.filter((d) => d.status === "FOUND").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/?mode=${mode}&dataOrigin=${dataOrigin}`} className="text-sm text-slate-500 hover:underline">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          {fact.label} &times; {provider.name}
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
          <span>{fact.politician.name}</span>
          <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
            {MODE_LABEL[mode]}
          </span>
        </p>
        {dataOrigin === "ALL" && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            This view combines real and synthetic observations and should not be used for research inference.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Canonical fact</p>
        <p className="mt-1 text-sm text-slate-800">{fact.canonicalFactText}</p>
        <p className="mt-2 text-xs text-slate-500">
          {fact.originalSourceUrl && fact.originalSourceDomain ? (
            <>
              Original source:{" "}
              <a href={fact.originalSourceUrl} target="_blank" rel="noreferrer" className="underline">
                {fact.originalSourceDomain}
              </a>
              {fact.originalSourceCategory ? ` (${fact.originalSourceCategory.replace(/_/g, " ")})` : ""}
            </>
          ) : (
            "Original source not specified"
          )}
          {fact.publishedAt ? ` · Published ${formatDateTime(fact.publishedAt)}` : ""}
        </p>
        {mode === "OPEN_ENDED_DISCOVERY" && (
          <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            This fact was never included in the prompt sent to the model. It is only checked against
            the model&apos;s general response after the fact.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="First checked" value={formatDateTime(firstChecked?.experimentRun.startedAt ?? null)} />
        <Stat label="First detected" value={formatDateTime(firstDetected?.detectedAt ?? null)} />
        <Stat label="Total checks" value={String(primaryRows.length)} />
        <Stat
          label="Detection rate"
          value={primaryRows.length ? `${Math.round((totalDetections / primaryRows.length) * 100)}%` : "—"}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Run history</h2>
        <div className="mt-3 flex flex-col gap-3">
          {sortedObservations.length === 0 && (
            <p className="text-sm text-slate-500">No experiment runs recorded yet for this pair under this mode.</p>
          )}
          {sortedObservations.map((obs) => {
            const d = obs.primary;
            const responseCitationDomains = d.experimentRun.citations.map((c) => c.domain);
            const domain = displayDomain(d.sourceRelationship, responseCitationDomains, fact.originalSourceDomain);
            const otherFacts = d.experimentRun.detections.filter((sib) => sib.factId !== factId);
            const historicalRows = obs.history.filter((h) => h.id !== d.id);

            return (
              <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {formatDateTime(d.experimentRun.startedAt)} &middot; repetition {d.experimentRun.repetitionIndex + 1}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      Prompt: <span className="font-normal">{d.experimentRun.prompt.text}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${DATA_ORIGIN_STYLE[d.experimentRun.dataOrigin]}`}
                    >
                      {d.experimentRun.dataOrigin}
                    </span>
                    <StatusBadge
                      status={d.status}
                      domain={domain}
                      semanticStatus={d.semanticStatus}
                      verificationError={d.verificationStatus === "ERROR"}
                      classifiedWithCurrentDetector={obs.isCurrentDetectorVersion}
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Full response</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                      {d.experimentRun.answerText ?? d.experimentRun.errorMessage ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Matching excerpt
                      </p>
                      <p className="mt-1 text-sm italic text-slate-700">
                        {d.matchingExcerpt ?? "No matching excerpt."}
                      </p>
                    </div>
                    <div className="text-xs text-slate-500">
                      {d.verificationStatus === "ERROR" && (
                        <p className="mb-1 rounded border border-orange-200 bg-orange-50 px-2 py-1 font-medium text-orange-800">
                          Semantic verification technically failed
                          {d.verificationErrorCategory ? ` (${d.verificationErrorCategory.replace(/_/g, " ").toLowerCase()})` : ""}
                          {d.verifierRetryCount > 0 ? ` after ${d.verifierRetryCount} retr${d.verifierRetryCount === 1 ? "y" : "ies"}` : ""}.
                          This is NOT a NOT_FOUND judgment - the answer was never actually checked.
                        </p>
                      )}
                      <p>
                        Result:{" "}
                        <span className="font-medium text-slate-700">
                          {d.semanticStatus === "PARTIAL_SUPPORT" ? "Partial support" : d.status.replace(/_/g, " ")}
                        </span>
                        {"  ·  "}
                        Confidence: <span className="font-medium text-slate-700">{d.confidence.toFixed(2)}</span>
                        {"  ·  "}
                        Detector: <span className="font-medium text-slate-700">{d.detectionMethod.replace(/_/g, " ")}</span>
                        {"  \u00b7  "}
                        Version: <span className="font-medium text-slate-700">{d.detectorVersion}</span>
                      </p>
                      {d.semanticVerifierModel && (
                        <p className="mt-0.5">
                          Verifier:{" "}
                          <span className="font-medium text-slate-700">
                            {d.semanticVerifierModel}
                            {d.semanticVerifierVersion ? ` (${d.semanticVerifierVersion})` : ""}
                          </span>
                        </p>
                      )}
                      {d.justification && (
                        <p className="mt-0.5">
                          Reason: <span className="text-slate-700">{d.justification}</span>
                        </p>
                      )}
                      <p className="mt-0.5">
                        Source relationship:{" "}
                        <span className="font-medium text-slate-700">
                          {SOURCE_RELATIONSHIP_LABEL[d.sourceRelationship]}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Citations returned in the same response ({d.experimentRun.citations.length})
                      </p>
                      {d.experimentRun.citations.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                          {d.experimentRun.citations.map((c) => (
                            <li key={c.id}>
                              <a href={c.url} target="_blank" rel="noreferrer" className="underline">
                                {c.domain}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-slate-400">No citations were returned with this response.</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        Specific supporting citation:{" "}
                        <span className="font-medium text-slate-700">
                          {d.citationAttribution === "CLAIM_LEVEL"
                            ? "Provider-attributed (claim-level)"
                            : "Not determinable from provider response"}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                {mode === "OPEN_ENDED_DISCOVERY" && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Other monitored facts detected in this same response
                    </p>
                    {otherFacts.length === 0 ? (
                      <p className="mt-1 text-xs text-slate-400">No other facts were being monitored in this run.</p>
                    ) : (
                      <ul className="mt-1 space-y-1 text-xs text-slate-700">
                        {otherFacts.map((sib) => (
                          <li key={sib.id} className="flex items-center gap-2">
                            <span>{sib.status === "FOUND" ? "✅" : sib.status === "UNCERTAIN" ? "⚠️" : "❌"}</span>
                            <span>{sib.fact.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {historicalRows.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Historical classifications (detector-versioning audit - kept for reproducibility, never
                      counted alongside the current classification above)
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {historicalRows.map((h) => (
                        <li key={h.id}>
                          {h.detectorVersion}:{" "}
                          <span className="font-medium text-slate-700">
                            {h.semanticStatus === "PARTIAL_SUPPORT" ? "Partial support" : h.status.replace(/_/g, " ")}
                          </span>
                          {` (confidence ${h.confidence.toFixed(2)})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
