import { detectFactDeterministicV2, type DeterministicFactInput } from "./deterministicDetectorV2";
import type { FactVerifier } from "./factVerifier";
import type { DetectionStatusValue, DetectionMethodValue } from "./detectFacts";

/** Bumped whenever the deterministic stage's matching logic materially
 * changes, so `FactDetection.detectorVersion` always reflects exactly which
 * algorithm produced a given row (Phase 5 Part F). */
export const DETECTOR_VERSION = "v2-window-deterministic";

export interface HybridDetectionResult {
  status: DetectionStatusValue;
  confidence: number;
  matchingExcerpt: string | null;
  detectionMethod: DetectionMethodValue;
  detectorVersion: string;
  deterministicScore: number;
  semanticVerifierModel: string | null;
  semanticVerifierVersion: string | null;
  justification: string | null;
}

/**
 * The Phase 5 hybrid detection pipeline (Part B/C):
 *
 *   stage 1 (deterministic, always runs) -> decisive?
 *     yes -> FOUND / NOT_FOUND, done.
 *     no  -> stage 2 (semantic entailment), ONLY if a `verifier` is
 *            supplied. Production (`runExperimentCore.ts`) currently calls
 *            this WITHOUT a verifier - Phase 5 built the interface but
 *            stopped before wiring a live judge (Part D) - so inconclusive
 *            cases are honestly reported as UNCERTAIN with a note, exactly
 *            as before, rather than silently guessing.
 *
 * The verifier (when supplied) never sees anything except the canonical
 * fact text and the already-persisted answer text - it cannot influence
 * retrieval (Part C).
 */
export async function hybridDetectFact(
  fact: DeterministicFactInput,
  answerText: string,
  verifier?: FactVerifier
): Promise<HybridDetectionResult> {
  const stage1 = detectFactDeterministicV2(fact, answerText);

  if (stage1.status === "FOUND_DETERMINISTIC" || stage1.status === "NOT_FOUND_DETERMINISTIC") {
    return {
      status: stage1.status === "FOUND_DETERMINISTIC" ? "FOUND" : "NOT_FOUND",
      confidence: stage1.score,
      matchingExcerpt: stage1.matchingExcerpt,
      detectionMethod: stage1.detectionMethod,
      detectorVersion: DETECTOR_VERSION,
      deterministicScore: stage1.score,
      semanticVerifierModel: null,
      semanticVerifierVersion: null,
      justification: null,
    };
  }

  // stage1.status === "NEEDS_SEMANTIC_VERIFICATION"
  if (!verifier) {
    return {
      status: "UNCERTAIN",
      confidence: stage1.score,
      matchingExcerpt: stage1.matchingExcerpt,
      detectionMethod: stage1.detectionMethod,
      detectorVersion: DETECTOR_VERSION,
      deterministicScore: stage1.score,
      semanticVerifierModel: null,
      semanticVerifierVersion: null,
      justification:
        "Deterministic stage found partial lexical evidence but was not decisive " +
        `(matched ${stage1.matchedComponents.length}/${stage1.totalComponents} components). ` +
        "Semantic verification is not yet enabled in production - Phase 5 built the " +
        "FactVerifier interface but stopped before wiring a live judge (see Part D).",
    };
  }

  const verified = await verifier.verify({ fact: fact.canonicalFactText, answer: answerText });
  return {
    status: verified.status,
    confidence: verified.confidence,
    matchingExcerpt: verified.evidenceExcerpt ?? stage1.matchingExcerpt,
    detectionMethod: "SEMANTIC_ENTAILMENT",
    detectorVersion: DETECTOR_VERSION,
    deterministicScore: stage1.score,
    semanticVerifierModel: verified.verifierModel,
    semanticVerifierVersion: verified.verifierVersion,
    justification: verified.justification,
  };
}
