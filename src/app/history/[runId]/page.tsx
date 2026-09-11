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

function formatCost(cost: number | null): string {
  if (cost == null) return "—";
  return `$${cost.toFixed(4)}`;
}

const ACCESS_LAYER_LABEL: Record<string, string> = {
  OPENROUTER: "OpenRouter",
  DIRECT_SDK: "Direct provider SDK",
  NONE: "N/A (mock)",
};

const SEARCH_MECHANISM_LABEL: Record<string, string> = {
  OPENROUTER_NATIVE_WEB_PLUGIN: "OpenRouter native web plugin",
  PROVIDER_INHERENT_WEB_SEARCH: "Provider-inherent web search (always-on)",
  NONE: "None",
};

const DATA_ORIGIN_STYLE: Record<string, string> = {
  REAL: "border-violet-200 bg-violet-50 text-violet-700",
  MOCK: "border-slate-200 bg-slate-100 text-slate-500",
};

const SPAN_KIND_LABEL: Record<string, string> = {
  CLAIM_LEVEL: "Claim-level",
  RESPONSE_LEVEL: "Response-level",
};

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  const run = await prisma.experimentRun.findUnique({
    where: { id: runId },
    include: {
      provider: true,
      prompt: { include: { politician: true } },
      citations: true,
      detections: { include: { fact: true } },
      searchQueries: true,
    },
  });

  if (!run) notFound();

  const responseCitationDomains = run.citations.map((c) => c.domain);
  const MODE_LABEL: Record<string, string> = {
    TARGETED_RETRIEVAL: "Targeted retrieval",
    OPEN_ENDED_DISCOVERY: "Open-ended discovery",
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/history" className="text-sm text-slate-500 hover:underline">
          &larr; Back to run history
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
          Run detail
          <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
            {MODE_LABEL[run.mode] ?? run.mode}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${DATA_ORIGIN_STYLE[run.dataOrigin]}`}
          >
            {run.dataOrigin}
          </span>
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {run.prompt.politician.name} &middot; {run.provider.name} &middot; {formatDateTime(run.startedAt)}
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Provenance</p>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
          <InfoRow label="Provider family" value={run.provider.name} />
          <InfoRow label="Requested model" value={run.modelSnapshot ?? run.provider.model} />
          <InfoRow label="Returned model" value={run.returnedModel ?? "—"} />
          <InfoRow label="Upstream provider" value={run.upstreamProvider ?? "—"} />
          <InfoRow label="Access layer" value={ACCESS_LAYER_LABEL[run.accessLayer] ?? run.accessLayer} />
          <InfoRow label="Search mechanism" value={SEARCH_MECHANISM_LABEL[run.searchMechanism] ?? run.searchMechanism} />
          <InfoRow label="Web search enabled" value={run.webSearchEnabled ? "Yes" : "No"} />
          <InfoRow label="Provider API" value={run.providerApi ?? "—"} />
          <InfoRow label="Generation/request ID" value={run.providerRequestId ?? "—"} />
          <InfoRow label="Timestamp" value={formatDateTime(run.startedAt)} />
        </dl>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Usage &amp; cost</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <InfoRow label="Input tokens" value={run.inputTokens != null ? String(run.inputTokens) : "—"} />
          <InfoRow label="Output tokens" value={run.outputTokens != null ? String(run.outputTokens) : "—"} />
          <InfoRow label="Total tokens" value={run.totalTokens != null ? String(run.totalTokens) : "—"} />
          <InfoRow label="Provider cost" value={formatCost(run.providerCost)} />
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Search queries:{" "}
          {run.searchQueries.length > 0
            ? run.searchQueries.map((q) => q.query).join("; ")
            : run.accessLayer === "OPENROUTER"
              ? "Not exposed by OpenRouter"
              : "None recorded"}
        </p>
        {run.retryCount > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            Technical retries before this result: {run.retryCount}
          </p>
        )}
        {run.status === "ERROR" && run.errorCategory && (
          <p className="mt-1 text-xs text-red-600">Error category: {run.errorCategory}</p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Prompt</p>
        <p className="mt-1 text-sm text-slate-800">{run.prompt.text}</p>
        <p className="mt-1 text-xs text-slate-400">Prompt type: {run.prompt.promptType}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Full answer</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
          {run.answerText ?? run.errorMessage ?? "—"}
        </p>
      </div>

      {run.citations.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Citations / sources ({run.citations.length})
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {run.citations.map((c) => (
              <li key={c.id} className="border-b border-slate-100 pb-2 last:border-0">
                <a href={c.url} target="_blank" rel="noreferrer" className="underline">
                  {c.title ?? c.url}
                </a>
                <span className="ml-2 text-xs text-slate-400">{c.domain}</span>
                <span className="ml-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  {SPAN_KIND_LABEL[c.spanKind] ?? c.spanKind}
                </span>
                {c.startIndex != null && c.endIndex != null && (
                  <span className="ml-2 text-[10px] text-slate-400">
                    chars {c.startIndex}–{c.endIndex}
                  </span>
                )}
                {c.citedText && <p className="mt-1 text-xs italic text-slate-500">&ldquo;{c.citedText}&rdquo;</p>}
                {c.rawUrl && c.rawUrl !== c.url && (
                  <p className="mt-1 text-[10px] text-slate-400">Raw (unresolved) URL: {c.rawUrl}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Fact detections</h2>
        <div className="mt-3 flex flex-col gap-3">
          {(() => {
            // Detector-versioning audit: this run can have more than one
            // FactDetection row per fact when it has been reprocessed with a
            // newer detector - collapse to exactly one authoritative row per
            // fact, preserving original list order, so a fact is never shown
            // (or counted) twice.
            const observations = selectAuthoritativeObservations(run.detections);
            const firstIndexByFactId = new Map<string, number>();
            run.detections.forEach((d, i) => {
              if (!firstIndexByFactId.has(d.factId)) firstIndexByFactId.set(d.factId, i);
            });
            const sortedObservations = [...observations].sort(
              (a, b) => (firstIndexByFactId.get(a.factId) ?? 0) - (firstIndexByFactId.get(b.factId) ?? 0)
            );
            return sortedObservations.map((obs) => {
              const d = obs.primary;
              const historicalRows = obs.history.filter((h) => h.id !== d.id);
              const domain = d.sourceRelationship === "ORIGINAL_SOURCE" ? d.fact.originalSourceDomain : responseCitationDomains[0] ?? null;
              return (
                <div key={d.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{d.fact.label}</p>
                      {d.verificationStatus === "ERROR" ? (
                        <p className="mt-1 rounded border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-medium text-orange-800">
                          Semantic verification technically failed
                          {d.verificationErrorCategory ? ` (${d.verificationErrorCategory.replace(/_/g, " ").toLowerCase()})` : ""}
                          {d.verifierRetryCount > 0 ? ` after ${d.verifierRetryCount} retr${d.verifierRetryCount === 1 ? "y" : "ies"}` : ""}.
                          This is NOT a NOT_FOUND judgment.
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-slate-500">Evidence: {d.matchingExcerpt ?? "No matching excerpt."}</p>
                          {d.justification && <p className="mt-0.5 text-xs text-slate-500">Reason: {d.justification}</p>}
                        </>
                      )}
                      <p className="mt-1 text-xs text-slate-400">
                        Confidence {d.confidence.toFixed(2)} &middot; Verifier{" "}
                        {d.semanticVerifierModel ?? d.detectionMethod.replace(/_/g, " ")} &middot; Detector {d.detectorVersion}{" "}
                        &middot; citation attribution: {d.citationAttribution.replace(/_/g, " ").toLowerCase()}
                      </p>
                    </div>
                    <StatusBadge
                      status={d.status}
                      domain={domain}
                      semanticStatus={d.semanticStatus}
                      verificationError={d.verificationStatus === "ERROR"}
                      classifiedWithCurrentDetector={obs.isCurrentDetectorVersion}
                    />
                  </div>
                  {historicalRows.length > 0 && (
                    <div className="border-t border-slate-100 pt-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Historical classifications (not counted alongside the current one above)
                      </p>
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                        {historicalRows.map((h) => (
                          <li key={h.id}>
                            {h.detectorVersion}: <span className="font-medium text-slate-600">{h.status.replace(/_/g, " ")}</span>
                            {` (confidence ${h.confidence.toFixed(2)})`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

