/**
 * Phase 8 — the production semantic-only fact classifier.
 *
 * Phase 7.2's corrected audit established that the RAW semantic verifier
 * verdict (before any deterministic critical-component adjudication)
 * clearly outperforms every hybrid/adjudicated variant on the frozen
 * 84-fixture benchmark (88.1% 4-class accuracy, 0 false FOUND, 0 false
 * NOT_FOUND - see `/memories/repo/llm-fact-monitor.md` stage 15). This
 * function is therefore the ONLY production classification path:
 *
 *   provider answer -> fixed semantic verifier -> raw 4-class verdict
 *
 * It deliberately does NOT run `hybridDetectFact`'s deterministic gate and
 * does NOT trust `verifyWithMetadata`'s post-adjudication `result.status` -
 * it reads `llmRawStatus` directly, bypassing `adjudicateFinalVerdict()`
 * entirely (Phase 8 Section 14: deterministic v2 must never be a fast path
 * or override the semantic verdict). Deterministic v2 may optionally be
 * computed alongside as NON-AUTHORITATIVE audit metadata (`deterministicScore`)
 * - it never influences `status` or `semanticStatus` here.
 *
 * A technical verifier failure (timeout/rate-limit/outage/malformed
 * response/network/auth) is surfaced as `verificationStatus: "ERROR"` with
 * `semanticStatus: null` - it must NEVER be persisted as a substantive
 * NOT_FOUND (Phase 8 Section 6).
 */
import { verifyWithMetadata, VERIFIER_MODEL, VERIFIER_PROMPT_VERSION, type VerifierCallMetadata } from "./verifiers/openRouterFactVerifier";
import { detectFactDeterministicV2, type DeterministicFactInput } from "./deterministicDetectorV2";
import type { DetectionStatusValue } from "./detectFacts";
import type { VerifierErrorCategoryValue } from "./verifiers/verifierErrorClassification";

/** Bumped whenever this production classification path materially changes
 * (Phase 5 Part F provenance pattern), so `FactDetection.detectorVersion`
 * always reflects exactly which algorithm produced a given row. Distinct
 * from `v2-window-deterministic` (the deterministic-only stage) and
 * `v1-adjacent-bigram` (the original keyword matcher) - historical rows
 * keep whichever version actually produced them. */
export const SEMANTIC_ONLY_DETECTOR_VERSION = "v1-semantic-only-production";

/** The semantic verifier's raw, un-collapsed 4-class verdict. Mirrors
 * `VerifierRawStatus` in `factVerifier.ts` / `SemanticRawStatus` in the
 * Prisma schema. */
export type SemanticRawStatusValue = "FOUND" | "PARTIAL_SUPPORT" | "NOT_FOUND" | "UNCERTAIN";

export interface SemanticOnlyDetectionResult {
  /** Public/collapsed 3-class status for the simplified matrix display
   * (PARTIAL_SUPPORT collapses to UNCERTAIN here). "UNCERTAIN" is also
   * used as the display fallback when verification technically failed -
   * `verificationStatus`/`verificationErrorCategory` are what distinguish
   * that from a genuine epistemic UNCERTAIN judgment (Section 6). */
  status: DetectionStatusValue;
  /** The un-collapsed 4-class semantic verdict. Null when verification
   * technically failed. */
  semanticStatus: SemanticRawStatusValue | null;
  confidence: number;
  matchingExcerpt: string | null;
  justification: string | null;
  detectionMethod: "SEMANTIC_ENTAILMENT";
  detectorVersion: string;
  semanticVerifierModel: string;
  semanticVerifierVersion: string;
  /** Non-authoritative audit metadata only - see the file-level doc
   * comment. Never used to decide `status`/`semanticStatus`. */
  deterministicScore: number;
  verificationStatus: "SUCCESS" | "ERROR";
  verificationErrorCategory: VerifierErrorCategoryValue | null;
  verifierRetryCount: number;
  verifierRequestId: string | null;
  verifierCostUsd: number | null;
  verifierInputTokens: number | null;
  verifierOutputTokens: number | null;
  verifierTotalTokens: number | null;
}

function collapseToPublicStatus(raw: SemanticRawStatusValue): DetectionStatusValue {
  return raw === "PARTIAL_SUPPORT" ? "UNCERTAIN" : raw;
}

/** Injectable verify function, for tests only (Phase 8 Section 16) - lets
 * production-path tests exercise this function against mocked verifier
 * responses without ever calling the real OpenRouter API. Production
 * callers must never pass this. */
export interface SemanticOnlyDetectFactOptions {
  verify?: (input: { fact: string; answer: string }) => Promise<VerifierCallMetadata>;
}

export async function semanticOnlyDetectFact(
  fact: DeterministicFactInput,
  answerText: string,
  options: SemanticOnlyDetectFactOptions = {}
): Promise<SemanticOnlyDetectionResult> {
  const verify = options.verify ?? verifyWithMetadata;

  // Deterministic v2 is computed purely as non-authoritative audit
  // metadata (Section 14) - its output never affects `status` below.
  const deterministicAudit = detectFactDeterministicV2(fact, answerText);

  const meta = await verify({ fact: fact.canonicalFactText, answer: answerText });

  if (meta.verificationStatus === "ERROR" || meta.llmRawStatus === null) {
    return {
      status: "UNCERTAIN",
      semanticStatus: null,
      confidence: 0,
      matchingExcerpt: null,
      justification: meta.result.justification,
      detectionMethod: "SEMANTIC_ENTAILMENT",
      detectorVersion: SEMANTIC_ONLY_DETECTOR_VERSION,
      semanticVerifierModel: VERIFIER_MODEL,
      semanticVerifierVersion: VERIFIER_PROMPT_VERSION,
      deterministicScore: deterministicAudit.score,
      verificationStatus: "ERROR",
      verificationErrorCategory: meta.verificationErrorCategory,
      verifierRetryCount: meta.retryCount,
      verifierRequestId: meta.requestId,
      verifierCostUsd: meta.costUsd,
      verifierInputTokens: meta.inputTokens,
      verifierOutputTokens: meta.outputTokens,
      verifierTotalTokens: meta.totalTokens,
    };
  }

  // The RAW semantic verdict is authoritative - deliberately bypassing
  // `meta.result.status`/`meta.finalRawStatus`, which reflect the
  // deterministic-adjudicated verdict Phase 7.2 proved to be worse.
  const raw = meta.llmRawStatus;

  return {
    status: collapseToPublicStatus(raw),
    semanticStatus: raw,
    confidence: meta.result.confidence,
    matchingExcerpt: meta.result.evidenceExcerpt,
    justification: meta.result.justification,
    detectionMethod: "SEMANTIC_ENTAILMENT",
    detectorVersion: SEMANTIC_ONLY_DETECTOR_VERSION,
    semanticVerifierModel: VERIFIER_MODEL,
    semanticVerifierVersion: VERIFIER_PROMPT_VERSION,
    deterministicScore: deterministicAudit.score,
    verificationStatus: "SUCCESS",
    verificationErrorCategory: null,
    verifierRetryCount: meta.retryCount,
    verifierRequestId: meta.requestId,
    verifierCostUsd: meta.costUsd,
    verifierInputTokens: meta.inputTokens,
    verifierOutputTokens: meta.outputTokens,
    verifierTotalTokens: meta.totalTokens,
  };
}
