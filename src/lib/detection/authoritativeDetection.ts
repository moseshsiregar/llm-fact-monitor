import { SEMANTIC_ONLY_DETECTOR_VERSION } from "./semanticOnlyDetectFact";

/**
 * Phase 8 detector-versioning audit.
 *
 * The detector version treated as authoritative for CURRENT research
 * analysis. Re-exported under this name (rather than importing
 * `SEMANTIC_ONLY_DETECTOR_VERSION` directly at every aggregation/query
 * site) so every consumer shares one obvious name for "the version that
 * decides an observation's classification".
 */
export const CURRENT_ANALYSIS_DETECTOR_VERSION = SEMANTIC_ONLY_DETECTOR_VERSION;

export interface DetectionVersionLike {
  id: string;
  experimentRunId: string;
  factId: string;
  detectorVersion: string;
  detectedAt: Date;
}

export interface AuthoritativeObservation<T extends DetectionVersionLike> {
  experimentRunId: string;
  factId: string;
  /**
   * The single row this (experimentRunId, factId) pair contributes to
   * current-analysis aggregation. Prefers the row produced by
   * `CURRENT_ANALYSIS_DETECTOR_VERSION`; falls back to the most recent
   * historical row ONLY when no current-detector row exists yet for this
   * pair (so legacy/not-yet-reprocessed data still displays something
   * rather than going blank).
   */
  primary: T;
  /**
   * True only when `primary` was actually produced by the current
   * analysis detector version. False means this observation has NOT been
   * reprocessed with the semantic-only production detector yet and is
   * still running on a historical/deterministic classification - callers
   * must not present it as methodologically equivalent to a semantic
   * result (Phase 8 versioning audit item 4: "Not classified with current
   * detector").
   */
  isCurrentDetectorVersion: boolean;
  /**
   * Every detection row ever produced for this (run, fact) pair, oldest
   * first - for evidence/audit display ONLY. Never sum, average, or count
   * research-observation rates over this array directly; use `primary`
   * (exactly one entry per pair) for that.
   */
  history: T[];
}

/**
 * Collapses potentially-multiple `FactDetection` rows per
 * (experimentRunId, factId) pair - one such row can exist per historical
 * detector version that has ever classified that pair (e.g. a legacy
 * deterministic row AND a later semantic-only reprocessing row) - into
 * exactly ONE research observation per pair.
 *
 * Rationale (Phase 8 detector-versioning audit): "One provider response +
 * one monitored fact = one research observation. Different detector
 * versions are alternative measurements of that SAME observation, not
 * repetitions." Every dashboard/analysis aggregation MUST go through this
 * function before computing counts/rates, so a (run, fact) pair that has
 * been reprocessed with a newer detector is never counted twice, and two
 * detector versions are never summed as though they were two repetitions.
 */
export function selectAuthoritativeObservations<T extends DetectionVersionLike>(
  detections: T[]
): AuthoritativeObservation<T>[] {
  const groups = new Map<string, T[]>();
  for (const d of detections) {
    const key = `${d.experimentRunId}::${d.factId}`;
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }

  const observations: AuthoritativeObservation<T>[] = [];
  for (const [key, rows] of groups) {
    const [experimentRunId, factId] = key.split("::");
    const history = [...rows].sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());
    const currentRows = history.filter((d) => d.detectorVersion === CURRENT_ANALYSIS_DETECTOR_VERSION);
    const primary = currentRows.length ? currentRows[currentRows.length - 1] : history[history.length - 1];
    observations.push({
      experimentRunId,
      factId,
      primary,
      isCurrentDetectorVersion: currentRows.length > 0,
      history,
    });
  }
  return observations;
}
