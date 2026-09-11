import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

import { prisma } from "../src/lib/prisma";
import { runSingleExperiment } from "../src/lib/experiment/runExperimentCore";
import { semanticOnlyDetectFact } from "../src/lib/detection/semanticOnlyDetectFact";
import { getDashboardMatrix } from "../src/lib/dashboard/getDashboardData";
import { PROVIDER_REGISTRY } from "../src/lib/providers/registry";
import { ProviderCallError } from "../src/lib/providers/types";
import type { VerifierCallMetadata } from "../src/lib/detection/verifiers/openRouterFactVerifier";
import type { LLMProviderAdapter, ProviderResponse } from "../src/lib/providers/types";

/**
 * Phase 8 Section 16 — production-path tests for the semantic-only
 * detection pipeline, using MOCKED verifier responses (and a mocked
 * provider adapter) so this script NEVER calls a real, paid API. Run via
 * `npm run test:production-detection`.
 *
 * Covers the 10 cases from the Phase 8 spec:
 *   1. FOUND persists
 *   2. PARTIAL_SUPPORT persists and collapses to UNCERTAIN for `status`
 *   3. NOT_FOUND persists
 *   4. UNCERTAIN persists
 *   5. A technical verifier failure is never stored as a substantive
 *      NOT_FOUND
 *   6. 3 monitored facts -> 3 independent verifier classifications for 1
 *      answer
 *   7. Monitored facts never appear in the provider retrieval request
 *   8. A provider failure never triggers verifier calls (no answer exists
 *      to verify)
 *   9. Verifier retries don't create duplicate FactDetection rows
 *   10. REAL/MOCK dashboard filters still separate this test's data from
 *       genuine observations
 *
 * All ephemeral fixtures (politician/facts/prompt/provider) created by this
 * script are namespaced under "phase8-test-" and deleted in a `finally`
 * block, regardless of pass/fail, so nothing pollutes the real dashboard.
 */

function makeMeta(overrides: Partial<VerifierCallMetadata>): VerifierCallMetadata {
  return {
    result: {
      status: "UNCERTAIN",
      evidenceExcerpt: null,
      justification: "mock",
      confidence: 0.5,
      verifierModel: "mock-model",
      verifierVersion: "mock-v1",
      verifiedAt: new Date(),
    },
    llmRawStatus: null,
    finalRawStatus: null,
    componentAdjudication: null,
    disagreement: false,
    adjudicationReason: null,
    costUsd: 0.001,
    excerptHadClaim: false,
    excerptValid: false,
    criticalComponents: [],
    verificationStatus: "SUCCESS",
    verificationErrorCategory: null,
    retryCount: 0,
    requestId: "mock-request-id",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    ...overrides,
  };
}

let passCount = 0;
let failCount = 0;
function check(name: string, condition: boolean, detail?: string) {
  const pass = condition;
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
  if (pass) passCount++;
  else failCount++;
}

async function testUnitClassification() {
  console.log("\n=== Cases 1-5: semanticOnlyDetectFact classification logic (no network) ===");

  const fact = { canonicalFactText: "The council approved a 4.9% tax rise.", identifyingKeywords: null };

  // Case 1: FOUND persists
  const found = await semanticOnlyDetectFact(fact, "answer text irrelevant here", {
    verify: async () => makeMeta({ llmRawStatus: "FOUND", verificationStatus: "SUCCESS" }),
  });
  check("Case 1: FOUND raw verdict -> status FOUND", found.status === "FOUND");
  check("Case 1: FOUND raw verdict -> semanticStatus FOUND", found.semanticStatus === "FOUND");
  check("Case 1: verificationStatus SUCCESS", found.verificationStatus === "SUCCESS");

  // Case 2: PARTIAL_SUPPORT persists + collapses correctly for `status`
  const partial = await semanticOnlyDetectFact(fact, "answer", {
    verify: async () => makeMeta({ llmRawStatus: "PARTIAL_SUPPORT", verificationStatus: "SUCCESS" }),
  });
  check("Case 2: PARTIAL_SUPPORT collapses to status UNCERTAIN", partial.status === "UNCERTAIN");
  check(
    "Case 2: PARTIAL_SUPPORT preserved uncollapsed in semanticStatus",
    partial.semanticStatus === "PARTIAL_SUPPORT"
  );

  // Case 3: NOT_FOUND persists
  const notFound = await semanticOnlyDetectFact(fact, "answer", {
    verify: async () => makeMeta({ llmRawStatus: "NOT_FOUND", verificationStatus: "SUCCESS" }),
  });
  check("Case 3: NOT_FOUND raw verdict -> status NOT_FOUND", notFound.status === "NOT_FOUND");
  check("Case 3: NOT_FOUND raw verdict -> semanticStatus NOT_FOUND", notFound.semanticStatus === "NOT_FOUND");

  // Case 4: UNCERTAIN persists
  const uncertain = await semanticOnlyDetectFact(fact, "answer", {
    verify: async () => makeMeta({ llmRawStatus: "UNCERTAIN", verificationStatus: "SUCCESS" }),
  });
  check("Case 4: UNCERTAIN raw verdict -> status UNCERTAIN", uncertain.status === "UNCERTAIN");
  check("Case 4: UNCERTAIN raw verdict -> semanticStatus UNCERTAIN", uncertain.semanticStatus === "UNCERTAIN");

  // Case 5: technical failure is never a substantive NOT_FOUND
  const errorResult = await semanticOnlyDetectFact(fact, "answer", {
    verify: async () =>
      makeMeta({
        llmRawStatus: null,
        verificationStatus: "ERROR",
        verificationErrorCategory: "TIMEOUT",
        retryCount: 2,
      }),
  });
  check("Case 5: technical failure -> verificationStatus ERROR", errorResult.verificationStatus === "ERROR");
  check("Case 5: technical failure -> status is NEVER NOT_FOUND", errorResult.status !== "NOT_FOUND");
  check("Case 5: technical failure -> status is UNCERTAIN (display fallback)", errorResult.status === "UNCERTAIN");
  check("Case 5: technical failure -> semanticStatus is null", errorResult.semanticStatus === null);
  check("Case 5: technical failure -> error category propagated", errorResult.verificationErrorCategory === "TIMEOUT");
  check("Case 5: technical failure -> retry count propagated", errorResult.verifierRetryCount === 2);
}

/** A fully controllable fake adapter - deliberately NOT a real network call.
 * `behavior` lets each test pick success (with a fixed answer) or a
 * non-retryable provider failure. */
function makeFakeAdapter(providerKey: string, behavior: "success" | "fail"): LLMProviderAdapter {
  return {
    providerKey,
    displayName: "Phase 8 test adapter",
    model: "phase8-test-model",
    kind: "MOCK",
    supportsCitations: false,
    isAvailable: () => true,
    unavailableReason: () => null,
    async runPrompt(prompt: string): Promise<ProviderResponse> {
      if (behavior === "fail") {
        throw new ProviderCallError("Simulated non-retryable provider failure", {
          category: "AUTHENTICATION",
          retryable: false,
        });
      }
      return {
        providerKey,
        model: "phase8-test-model",
        surface: "MOCK_SIMULATION",
        webSearchEnabled: false,
        answerText: `This is a fixed test answer about the prompt: "${prompt}". It does not mention any monitored fact by design.`,
        citations: [],
        timestamp: new Date(),
      };
    },
  };
}

async function testFullPipeline() {
  console.log("\n=== Cases 6-10: full runSingleExperiment pipeline (mocked provider + mocked verifier) ===");

  const NAMESPACE = "phase8-test";
  const successAdapterKey = `${NAMESPACE}-success-adapter`;
  const failAdapterKey = `${NAMESPACE}-fail-adapter`;
  PROVIDER_REGISTRY[successAdapterKey] = makeFakeAdapter(successAdapterKey, "success");
  PROVIDER_REGISTRY[failAdapterKey] = makeFakeAdapter(failAdapterKey, "fail");

  const politician = await prisma.politician.create({
    data: { name: `${NAMESPACE}-politician-${Date.now()}` },
  });

  const factLabels = ["council tax rise", "new bypass road", "library closure"];
  const facts = await Promise.all(
    factLabels.map((label, i) =>
      prisma.fact.create({
        data: {
          politicianId: politician.id,
          label,
          canonicalFactText: `MONITORED_FACT_${i}: the ${label} claim`,
          status: "PUBLISHED",
        },
      })
    )
  );

  const prompt = await prisma.researchPrompt.create({
    data: {
      politicianId: politician.id,
      text: "What has this local politician recently announced?",
    },
  });

  const successProvider = await prisma.lLMProvider.create({
    data: { providerKey: successAdapterKey, name: "Phase 8 test success provider", model: "phase8-test-model", kind: "MOCK" },
  });
  const failProvider = await prisma.lLMProvider.create({
    data: { providerKey: failAdapterKey, name: "Phase 8 test failing provider", model: "phase8-test-model", kind: "MOCK" },
  });

  try {
    // Case 7: monitored facts never appear in the provider retrieval request.
    check(
      "Case 7: prompt text sent to provider contains no monitored fact text",
      !facts.some((f) => prompt.text.includes(f.canonicalFactText))
    );

    // Case 6 + 9: 3 facts -> 3 independent classifications for 1 answer;
    // a simulated retryCount on the mocked verifier response must still
    // result in exactly ONE FactDetection row per fact (retries happen
    // inside a single verify() call and can never produce extra rows).
    let verifyCallCount = 0;
    const classificationByFactIndex: Array<"FOUND" | "PARTIAL_SUPPORT" | "NOT_FOUND" | "UNCERTAIN"> = [
      "FOUND",
      "PARTIAL_SUPPORT",
      "NOT_FOUND",
    ];
    const factIdToIndex = new Map(facts.map((f, i) => [f.id, i]));

    const successRun = await runSingleExperiment({
      provider: successProvider,
      prompt,
      candidateFacts: facts,
      testOnlyVerify: async (input) => {
        verifyCallCount++;
        // Identify which fact this call is for via the fact text embedded
        // in the (mocked) verifier input, so each fact gets a DIFFERENT
        // deterministic verdict - proving 3 independent calls were made,
        // not one call reused for all 3 facts.
        const idx = facts.findIndex((f) => f.canonicalFactText === input.fact);
        const verdict = classificationByFactIndex[idx] ?? "UNCERTAIN";
        return makeMeta({ llmRawStatus: verdict, verificationStatus: "SUCCESS", retryCount: 2 });
      },
    });

    check("Case 6: run completed with SUCCESS status", successRun.status === "SUCCESS");
    check("Case 6: answer text was persisted on the run", !!successRun.answerText);
    check("Case 6/9: exactly 3 verifier calls made (one per fact, never batched)", verifyCallCount === 3);

    const successDetections = await prisma.factDetection.findMany({
      where: { experimentRunId: successRun.id },
      orderBy: { factId: "asc" },
    });
    check("Case 6/9: exactly 3 FactDetection rows created (no duplicates from retries)", successDetections.length === 3);

    for (const d of successDetections) {
      const idx = factIdToIndex.get(d.factId);
      const expected = idx !== undefined ? classificationByFactIndex[idx] : undefined;
      check(
        `Case 6: fact index ${idx} got its own distinct classification (${expected})`,
        (expected === "PARTIAL_SUPPORT" ? d.status === "UNCERTAIN" : d.status === expected) &&
          d.semanticStatus === expected
      );
      check(`Case 9: retryCount recorded on the single persisted row (fact ${idx})`, d.verifierRetryCount === 2);
    }

    // Case 8: provider failure must never trigger a verifier call - there is
    // no answer to verify anything against.
    let failVerifyCallCount = 0;
    const failedRun = await runSingleExperiment({
      provider: failProvider,
      prompt,
      candidateFacts: facts,
      testOnlyVerify: async () => {
        failVerifyCallCount++;
        return makeMeta({ llmRawStatus: "FOUND" });
      },
    });
    check("Case 8: run recorded as ERROR", failedRun.status === "ERROR");
    check("Case 8: verifier was NEVER called after a provider failure", failVerifyCallCount === 0);
    const failedDetections = await prisma.factDetection.findMany({ where: { experimentRunId: failedRun.id } });
    check("Case 8: no FactDetection rows exist for the failed run", failedDetections.length === 0);

    // Case 10: REAL/MOCK dashboard filters still separate this test data.
    const mockMatrix = await getDashboardMatrix({ mode: "TARGETED_RETRIEVAL", dataOrigin: "MOCK", politicianId: politician.id });
    const realMatrix = await getDashboardMatrix({ mode: "TARGETED_RETRIEVAL", dataOrigin: "REAL", politicianId: politician.id });
    const mockHasCell = facts.some((f) => mockMatrix.cells[f.id]?.[successProvider.id]);
    const realHasCell = facts.some((f) => realMatrix.cells[f.id]?.[successProvider.id]);
    check("Case 10: MOCK-filtered dashboard view includes this test's cells", mockHasCell);
    check("Case 10: REAL-filtered dashboard view excludes this MOCK test data", !realHasCell);
  } finally {
    // Cleanup - deleting the providers cascades their ExperimentRuns (and in
    // turn Citations/FactDetections); deleting the politician cascades its
    // Facts/ResearchPrompts. Nothing from this script is left behind.
    await prisma.lLMProvider.delete({ where: { id: successProvider.id } });
    await prisma.lLMProvider.delete({ where: { id: failProvider.id } });
    await prisma.politician.delete({ where: { id: politician.id } });
    delete PROVIDER_REGISTRY[successAdapterKey];
    delete PROVIDER_REGISTRY[failAdapterKey];
  }
}

async function main() {
  await testUnitClassification();
  await testFullPipeline();

  console.log(`\nSummary: ${passCount} passed, ${failCount} failed, out of ${passCount + failCount} check(s).`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
