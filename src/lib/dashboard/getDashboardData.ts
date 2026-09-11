import { prisma } from "@/lib/prisma";
import type { DashboardMatrix, DashboardSummary, MatrixCellSummary } from "./types";
import type { ExperimentMode } from "@prisma/client";
import { selectAuthoritativeObservations } from "@/lib/detection/authoritativeDetection";

/** REAL/MOCK/ALL data-origin selector for the dashboard (Phase 5 Part A).
 * Deliberately a plain union rather than reusing the Prisma `DataOrigin`
 * enum directly, since "ALL" is a dashboard-only concept with no equivalent
 * database value. */
export type DashboardDataOrigin = "REAL" | "MOCK" | "ALL";

export interface DashboardFilters {
  politicianId?: string;
  providerId?: string;
  /** Which research mode's results to show. The same fact × provider pair
   * can have different outcomes under each mode, so results are never mixed
   * together in one cell. */
  mode: ExperimentMode;
  /** Which data-origin observations to include. Callers should default this
   * to "REAL" - genuine API observations must never silently blend with
   * seeded/synthetic data. "ALL" is for development inspection only and
   * must be paired with a visible on-screen warning by the caller. */
  dataOrigin: DashboardDataOrigin;
}

function dataOriginWhere(dataOrigin: DashboardDataOrigin) {
  return dataOrigin === "ALL" ? {} : { dataOrigin };
}

/** Known original-source domains, used to bucket citation domains into a
 * source category for the "most frequently cited source categories" summary
 * metric. Anything not recognized falls back to a small heuristic, then
 * "Other/Unknown" - we never guess a category we can't justify. */
async function buildDomainCategoryMap(): Promise<Map<string, string>> {
  const facts = await prisma.fact.findMany({
    select: { originalSourceDomain: true, originalSourceCategory: true },
  });
  const map = new Map<string, string>();
  for (const f of facts) {
    if (!f.originalSourceDomain || !f.originalSourceCategory) continue;
    map.set(f.originalSourceDomain.toLowerCase(), f.originalSourceCategory);
  }
  return map;
}

function heuristicCategory(domain: string): string {
  const d = domain.toLowerCase();
  if (d.includes("wikipedia")) return "WIKIPEDIA";
  if (d.includes("twitter") || d.includes("facebook") || d.includes("instagram") || d.includes("x.com"))
    return "SOCIAL_MEDIA";
  if (d.includes("news") || d.includes("times") || d.includes("gazette")) return "LOCAL_NEWS";
  if (d.includes("parliament") || d.includes(".gov")) return "PARLIAMENTARY_RECORD";
  return "OTHER";
}

/** Builds the fact × provider matrix and its per-cell summaries. This is
 * the single source of truth the dashboard renders from - no experiment
 * results are ever hard-coded into UI components. */
export async function getDashboardMatrix(filters: DashboardFilters): Promise<DashboardMatrix> {
  const politicians = await prisma.politician.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
  });

  const facts = await prisma.fact.findMany({
    where: {
      active: true,
      ...(filters.politicianId ? { politicianId: filters.politicianId } : {}),
    },
    include: { politician: true },
    orderBy: [{ politicianId: "asc" }, { createdAt: "asc" }],
  });

  const providers = await prisma.lLMProvider.findMany({
    where: {
      active: true,
      ...(filters.providerId ? { id: filters.providerId } : {}),
    },
    orderBy: { name: "asc" },
  });

  const factIds = facts.map((f) => f.id);
  const providerIds = providers.map((p) => p.id);

  const detections =
    factIds.length && providerIds.length
      ? await prisma.factDetection.findMany({
          where: {
            factId: { in: factIds },
            // `experimentRun` is a to-one relation on FactDetection - Prisma
            // requires the `is` relation predicate here (a bare object is only
            // valid for to-many relations, which use some/every/none).
            experimentRun: {
              is: {
                providerId: { in: providerIds },
                mode: filters.mode,
                ...dataOriginWhere(filters.dataOrigin),
              },
            },
          },
          include: { experimentRun: { include: { citations: true } } },
          orderBy: { detectedAt: "asc" },
        })
      : [];

  const cells: DashboardMatrix["cells"] = {};

  for (const factId of factIds) cells[factId] = {};

  const grouped = new Map<string, typeof detections>();
  for (const d of detections) {
    const key = `${d.factId}::${d.experimentRun.providerId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }

  const factById = new Map(facts.map((f) => [f.id, f]));

  for (const [key, list] of grouped) {
    const [factId, providerId] = key.split("::");

    // Detector-versioning audit: a (experimentRun, fact) pair can have MORE
    // THAN ONE `FactDetection` row when it has been reprocessed with a
    // newer detector (e.g. a legacy deterministic row plus a later
    // semantic-only row). Those are alternative measurements of the SAME
    // research observation, never separate repetitions - collapse to
    // exactly one row per pair before computing anything below.
    const observations = selectAuthoritativeObservations(list);
    const sortedObservations = [...observations].sort(
      (a, b) => a.primary.experimentRun.startedAt.getTime() - b.primary.experimentRun.startedAt.getTime()
    );
    const latestObservation = sortedObservations[sortedObservations.length - 1];
    const latest = latestObservation.primary;
    const primaryRows = sortedObservations.map((o) => o.primary);

    const firstDetected = primaryRows.find((d) => d.status === "FOUND");
    const totalDetections = primaryRows.filter((d) => d.status === "FOUND").length;

    const latestResponseCitationDomains = latest.experimentRun.citations.map((c) => c.domain);
    const fact = factById.get(factId);
    // Best-effort display domain: NOT a claim that this domain specifically
    // supports this fact - see `latestCitationAttribution` /
    // `latestSourceRelationship`. If the response cited the fact's original
    // source, show that; otherwise show the first cited domain, if any.
    const latestDisplayDomain =
      latest.sourceRelationship === "ORIGINAL_SOURCE" && fact
        ? fact.originalSourceDomain
        : latestResponseCitationDomains[0] ?? null;

    // Phase 8 Section 12 - full per-repetition breakdown, now over
    // `primaryRows` (exactly one row per experimentRun x fact pair). Only
    // SUCCESSful verification calls count as valid research observations;
    // a technical verification error is neither a FOUND, NOT_FOUND, nor a
    // genuine UNCERTAIN judgment, so it must never inflate/deflate those
    // rates.
    const successOnly = primaryRows.filter((d) => d.verificationStatus === "SUCCESS");
    const observationCount = successOnly.length;
    const errorCount = primaryRows.length - observationCount;
    // Prefer the raw 4-class `semanticStatus` (Phase 8+ rows) so
    // PARTIAL_SUPPORT is never silently folded into UNCERTAIN here; fall
    // back to the collapsed `status` for historical rows that predate it.
    const foundCount = successOnly.filter((d) => (d.semanticStatus ?? d.status) === "FOUND").length;
    const partialSupportCount = successOnly.filter((d) => d.semanticStatus === "PARTIAL_SUPPORT").length;
    const notFoundCount = successOnly.filter((d) => (d.semanticStatus ?? d.status) === "NOT_FOUND").length;
    const uncertainCount = successOnly.filter((d) => (d.semanticStatus ?? d.status) === "UNCERTAIN").length;
    // Detector-versioning audit item 4: how many of these observations are
    // still running on a historical detector version, i.e. have not yet
    // been reprocessed with the current semantic-only production detector.
    // Never silently implied as equivalent to a semantic result.
    const pendingReclassificationCount = sortedObservations.filter((o) => !o.isCurrentDetectorVersion).length;

    const summary: MatrixCellSummary = {
      factId,
      providerId,
      latestStatus: latest.status as MatrixCellSummary["latestStatus"],
      latestSemanticStatus: (latest.semanticStatus as MatrixCellSummary["latestSemanticStatus"]) ?? null,
      latestVerificationStatus: latest.verificationStatus as MatrixCellSummary["latestVerificationStatus"],
      latestVerificationErrorCategory: latest.verificationErrorCategory ?? null,
      latestClassifiedWithCurrentDetector: latestObservation.isCurrentDetectorVersion,
      latestDisplayDomain,
      latestResponseCitationDomains,
      latestSourceRelationship: latest.sourceRelationship,
      latestCitationAttribution: latest.citationAttribution,
      firstCheckedAt: sortedObservations[0].primary.experimentRun.startedAt,
      firstDetectedAt: firstDetected?.detectedAt ?? null,
      mostRecentCheckedAt: latest.experimentRun.startedAt,
      totalChecks: sortedObservations.length,
      totalDetections,
      detectionRate: totalDetections / sortedObservations.length,
      latestExperimentRunId: latest.experimentRunId,
      observationCount,
      foundCount,
      partialSupportCount,
      notFoundCount,
      uncertainCount,
      errorCount,
      pendingReclassificationCount,
      foundRate: observationCount ? foundCount / observationCount : 0,
      partialSupportRate: observationCount ? partialSupportCount / observationCount : 0,
      notFoundRate: observationCount ? notFoundCount / observationCount : 0,
      uncertainRate: observationCount ? uncertainCount / observationCount : 0,
    };

    cells[factId][providerId] = summary;
  }

  return { politicians, facts, providers, cells };
}

/** Computes the headline metrics shown above the matrix. `filters` must be
 * the SAME filters passed to `getDashboardMatrix` so counts respect the
 * active mode/dataOrigin selection (Phase 5 Part A: "Detection rates,
 * first-detection times, counts and matrices must respect this filter"). */
export async function getDashboardSummary(
  matrix: DashboardMatrix,
  filters: DashboardFilters
): Promise<DashboardSummary> {
  const totalExperimentRuns = await prisma.experimentRun.count({
    where: { mode: filters.mode, ...dataOriginWhere(filters.dataOrigin) },
  });
  const publishedFacts = matrix.facts.filter((f) => f.status === "PUBLISHED");

  const perProviderDiscoveryPercent = matrix.providers.map((provider) => {
    const discovered = publishedFacts.filter(
      (fact) => (matrix.cells[fact.id]?.[provider.id]?.totalDetections ?? 0) > 0
    ).length;
    return {
      providerId: provider.id,
      providerName: provider.name,
      percent: publishedFacts.length ? Math.round((discovered / publishedFacts.length) * 100) : 0,
    };
  });

  const perProviderAvgDaysToFirstDiscovery = matrix.providers.map((provider) => {
    const days: number[] = [];
    for (const fact of publishedFacts) {
      const cell = matrix.cells[fact.id]?.[provider.id];
      if (cell?.firstDetectedAt && fact.publishedAt) {
        const diffMs = cell.firstDetectedAt.getTime() - fact.publishedAt.getTime();
        days.push(diffMs / (1000 * 60 * 60 * 24));
      }
    }
    return {
      providerId: provider.id,
      providerName: provider.name,
      avgDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
    };
  });

  const domainCategoryMap = await buildDomainCategoryMap();
  const allCitations = await prisma.citation.findMany({
    // `experimentRun` is a to-one relation on Citation - same `is` predicate
    // requirement as the FactDetection query above.
    where: {
      experimentRun: {
        is: { mode: filters.mode, ...dataOriginWhere(filters.dataOrigin) },
      },
    },
    select: { domain: true },
  });
  const categoryCounts = new Map<string, number>();
  for (const c of allCitations) {
    const category = domainCategoryMap.get(c.domain.toLowerCase()) ?? heuristicCategory(c.domain);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  const topSourceCategories = [...categoryCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalFacts: matrix.facts.length,
    totalPublishedFacts: publishedFacts.length,
    totalExperimentRuns,
    perProviderDiscoveryPercent,
    perProviderAvgDaysToFirstDiscovery,
    topSourceCategories,
  };
}
