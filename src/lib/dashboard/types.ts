import type { Fact, LLMProvider, Politician } from "@prisma/client";

export interface MatrixCellSummary {
  factId: string;
  providerId: string;
  /** Status of the most recent check for this fact × provider pair. Used
   * for the simplified matrix badge - collapses PARTIAL_SUPPORT into
   * UNCERTAIN and does not by itself distinguish a technical verification
   * error (see `latestVerificationStatus`). */
  latestStatus: "FOUND" | "NOT_FOUND" | "UNCERTAIN";
  /** The most recent check's un-collapsed 4-class semantic verdict, when
   * available (Phase 8). Null for pre-Phase-8 rows or when the most recent
   * check's verification technically failed. */
  latestSemanticStatus: "FOUND" | "PARTIAL_SUPPORT" | "NOT_FOUND" | "UNCERTAIN" | null;
  /** Whether the most recent check's semantic verifier call succeeded or
   * technically failed. Historical (pre-Phase-8) rows default to SUCCESS. */
  latestVerificationStatus: "SUCCESS" | "ERROR";
  latestVerificationErrorCategory: string | null;
  /** Detector-versioning audit - whether the most recent observation's
   * `latestStatus`/`latestSemanticStatus` were produced by the CURRENT
   * analysis detector version (the semantic-only production detector).
   * False means this pair has not been reprocessed yet and is still
   * showing a historical/deterministic classification - the UI must
   * present this distinctly (e.g. "Not classified with current detector"),
   * never as an equivalent semantic result. */
  latestClassifiedWithCurrentDetector: boolean;
  /** Best-effort domain to show under the status badge. Derived from ALL
   * citations returned with the response (response-level), NOT a claim that
   * this specific domain supports this specific fact - see
   * `latestCitationAttribution`. Null when no citations were recorded. */
  latestDisplayDomain: string | null;
  /** Every domain cited in the most recent check's response, for the
   * detail/evidence view. */
  latestResponseCitationDomains: string[];
  latestSourceRelationship: string;
  /** Whether `latestDisplayDomain` reflects claim-level provider evidence, a
   * response-level inference, or is unknown/not applicable. Surfaced so the
   * UI never overstates certainty. */
  latestCitationAttribution: string;
  firstCheckedAt: Date;
  firstDetectedAt: Date | null;
  mostRecentCheckedAt: Date;
  totalChecks: number;
  totalDetections: number;
  detectionRate: number;
  latestExperimentRunId: string;
  /** Phase 8 Section 12 - full per-repetition breakdown, so a single
   * "latest" observation never silently hides the others. `observationCount`
   * excludes technical-error observations (only SUCCESS verification calls
   * count as valid research observations); `errorCount` tracks those
   * separately. Rates are relative to `observationCount` (0 when there are
   * no valid observations yet). Uses `semanticStatus` when available
   * (Phase 8+ rows), falling back to the collapsed `status` for historical
   * rows that predate the 4-class field. */
  observationCount: number;
  foundCount: number;
  partialSupportCount: number;
  notFoundCount: number;
  uncertainCount: number;
  errorCount: number;
  foundRate: number;
  partialSupportRate: number;
  notFoundRate: number;
  uncertainRate: number;
  /** Detector-versioning audit - number of the `observationCount` +
   * `errorCount` observations above that are still running on a
   * historical detector version (not yet reprocessed with the current
   * semantic-only production detector). Never adds extra observations by
   * itself; it is a subset annotation of the counts already above. */
  pendingReclassificationCount: number;
}

export interface DashboardMatrix {
  politicians: Politician[];
  facts: (Fact & { politician: Politician })[];
  providers: LLMProvider[];
  /** cells[factId][providerId] */
  cells: Record<string, Record<string, MatrixCellSummary | undefined>>;
}

export interface DashboardSummary {
  totalFacts: number;
  totalPublishedFacts: number;
  totalExperimentRuns: number;
  perProviderDiscoveryPercent: { providerId: string; providerName: string; percent: number }[];
  perProviderAvgDaysToFirstDiscovery: { providerId: string; providerName: string; avgDays: number | null }[];
  topSourceCategories: { label: string; count: number }[];
}
