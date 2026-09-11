import type { FactVerifier, SemanticVerificationInput, SemanticVerificationResult } from "../factVerifier";

/**
 * Phase 5, Part D: the `FactVerifier` abstraction and pipeline shape are
 * built and testable, but NO live semantic-verifier API/model is wired in
 * yet. This stub exists so the interface is concrete and the hybrid
 * pipeline (`hybridDetectFact`) can be exercised end-to-end in tests, while
 * making it impossible to accidentally invoke a real (paid or local) judge
 * before that choice is made deliberately.
 *
 * Deciding between a fixed external LLM judge, a local NLI/entailment
 * model, or a human-in-the-loop combination is an explicit follow-up
 * decision - not made by this stub.
 */
export class UnimplementedFactVerifier implements FactVerifier {
  async verify(_input: SemanticVerificationInput): Promise<SemanticVerificationResult> {
    throw new Error(
      "Semantic verification is not yet wired to a live judge. Phase 5 intentionally stopped " +
        "before choosing/calling a paid LLM judge, a local NLI model, or a human-validation " +
        "workflow (see Part D of the Phase 5 spec). Provide a real FactVerifier implementation " +
        "to `hybridDetectFact()` to enable stage 2."
    );
  }
}
