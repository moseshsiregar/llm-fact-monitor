/**
 * Phase 5, Part B stage 2 / Part C — post-retrieval semantic entailment.
 *
 * A `FactVerifier` sees ONLY the canonical monitored fact text and the
 * already-returned provider answer. It must NEVER influence the original
 * provider request or web search (it runs strictly after the response is
 * saved), and provider adapters must remain unaware of monitored facts -
 * this keeps retrieval and verification architecturally separate so the
 * tested model never judges its own answer (Part C).
 *
 * The task is entailment ("does the answer substantively assert the
 * fact?"), not topical similarity - a response that merely discusses the
 * same subject without asserting the specific proposition must not be
 * marked FOUND.
 */
import type { CriticalComponentCheckResult } from "./verifiers/criticalComponents";

export interface SemanticVerificationInput {
  /** The canonical monitored fact text, exactly as entered by the
   * researcher (may contain several atomic components - see Part B's
   * "Atomic proposition handling"). */
  fact: string;
  /** The provider's full, already-persisted answer text. */
  answer: string;
}

export type SemanticStatus = "FOUND" | "NOT_FOUND" | "UNCERTAIN";

/** The raw (pre-public-collapse) verdict vocabulary shared by the semantic
 * verifier's own LLM judgment and the deterministic component-adjudication
 * layer, so both sides of the Phase 6 follow-up adjudication speak the same
 * language. `PARTIAL_SUPPORT` always collapses to the public `UNCERTAIN`
 * status. */
export type VerifierRawStatus = "FOUND" | "NOT_FOUND" | "PARTIAL_SUPPORT" | "UNCERTAIN";

/** The deterministic critical-component layer's own opinion, independent of
 * whatever the semantic verifier said. `NOT_INFORMATIVE` means the fact
 * yielded no extractable critical components at all (see Rule E), so the
 * component layer has no opinion and defers entirely to the semantic
 * verifier. */
export type ComponentAdjudication = VerifierRawStatus | "NOT_INFORMATIVE";

/**
 * Phase 6 second follow-up — full disagreement-provenance audit trail. The
 * semantic verifier's raw verdict is evidence, not absolute authority: the
 * final verdict is produced by explicitly combining it with the
 * deterministic critical-component coverage (see Rules A-E in
 * `openRouterFactVerifier.ts`'s `adjudicateFinalVerdict`). Recording all
 * three verdicts plus whether they disagreed is important for research
 * reproducibility - a researcher can see exactly when and why the two
 * signals diverged.
 */
export interface VerifierAdjudication {
  /** The semantic (LLM) verifier's own raw verdict, before adjudication. */
  semanticRawVerdict: VerifierRawStatus;
  /** The deterministic critical-component layer's own opinion. */
  componentAdjudication: ComponentAdjudication;
  /** The combined, final raw verdict (what the public `status` is
   * collapsed from). */
  finalVerdict: VerifierRawStatus;
  /** True when `finalVerdict` differs from `semanticRawVerdict` - i.e. the
   * deterministic layer overrode or adjusted the semantic judge's opinion. */
  disagreement: boolean;
  /** Short human-readable explanation of how the final verdict was
   * reached, especially why it may differ from the semantic verifier's raw
   * verdict. */
  adjudicationReason: string;
}

export interface SemanticVerificationResult {
  status: SemanticStatus;
  /** Verbatim excerpt from `answer` that supports the verdict, if any. */
  evidenceExcerpt: string | null;
  /** Short human-readable justification for the verdict - required so a
   * researcher can audit why the verifier decided what it decided. */
  justification: string;
  confidence: number;
  /** Identifies which verifier (model/system) produced this result. */
  verifierModel: string;
  /** Version string for the verifier implementation/prompt, so historical
   * results remain attributable if the verifier changes later. */
  verifierVersion: string;
  verifiedAt: Date;
  /** Phase 6 follow-up: per-critical-component precision audit trail (exact
   * dates/years/numbers/percentages/titles/proper nouns extracted from the
   * fact, and whether the answer supports each at the required precision).
   * Optional/additive - not required on the main dashboard yet; intended
   * for detailed evidence pages and raw verification metadata. Absent when
   * the fact yielded no extractable critical components, or when this
   * verifier implementation doesn't populate it. */
  criticalComponents?: CriticalComponentCheckResult[];
  /** Phase 6 second follow-up: full disagreement-provenance record between
   * the semantic verifier and the deterministic component layer. Optional/
   * additive, same rationale as `criticalComponents`. */
  adjudication?: VerifierAdjudication;
}

export interface FactVerifier {
  verify(input: SemanticVerificationInput): Promise<SemanticVerificationResult>;
}
