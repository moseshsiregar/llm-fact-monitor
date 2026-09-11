import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

import { prisma } from "../src/lib/prisma";
import { semanticOnlyDetectFact, SEMANTIC_ONLY_DETECTOR_VERSION } from "../src/lib/detection/semanticOnlyDetectFact";
import { classifySourceRelationshipFromDomains } from "../src/lib/detection/sourceRelationship";
import { mapWithConcurrency } from "../src/lib/concurrency";
import { getDashboardMatrix } from "../src/lib/dashboard/getDashboardData";
import { VERIFIER_MODEL } from "../src/lib/detection/verifiers/openRouterFactVerifier";

/**
 * Phase 8 — reprocesses the already-stored Andy Burnham REAL pilot
 * experiment (`cmtwyegqi000eo1zw7abk75y8`) with the semantic-only
 * production detector, WITHOUT any new provider retrieval.
 *
 * Explicit constraints (user-approved, non-negotiable):
 *   - Reads ONLY the 4 existing `ExperimentRun.answerText` values already
 *     in the DB. NEVER calls `adapter.runPrompt()` / any provider API.
 *   - Makes exactly 4 x 3 = 12 real semantic verifier calls (one fact +
 *     one stored answer per call, never batched).
 *   - `prisma.factDetection.create()`s a NEW row per (run, fact) pair,
 *     tagged `detectorVersion: SEMANTIC_ONLY_DETECTOR_VERSION`. NEVER
 *     calls `update()`/`delete()` on any existing `FactDetection` row.
 *
 * Run via `npx tsx scripts/reprocess-pilot-semantic-only.ts`.
 */

const EXPERIMENT_ID = "cmtwyegqi000eo1zw7abk75y8";
const VERIFIER_CONCURRENCY = 3;

async function main() {
  const experiment = await prisma.experiment.findUniqueOrThrow({
    where: { id: EXPERIMENT_ID },
    include: {
      facts: { include: { fact: true } },
      runs: {
        where: { status: "SUCCESS" },
        include: { provider: true, citations: true },
        orderBy: { startedAt: "asc" },
      },
    },
  });

  const facts = experiment.facts.map((ef) => ef.fact);
  const runs = experiment.runs;

  console.log(`Experiment ${EXPERIMENT_ID}: ${runs.length} stored SUCCESS run(s), ${facts.length} monitored fact(s).`);
  console.log(`Expected verifier calls: ${runs.length} x ${facts.length} = ${runs.length * facts.length}`);

  // Pre-flight: exactly the 12 pairs the user approved. Fail loudly rather
  // than silently reprocessing a different shape of data.
  if (runs.length !== 4 || facts.length !== 3) {
    throw new Error(
      `Refusing to proceed: expected 4 runs x 3 facts = 12 pairs, found ${runs.length} runs x ${facts.length} facts. ` +
        "This script is scoped to the user-approved Andy Burnham pilot reprocessing only."
    );
  }
  for (const run of runs) {
    if (!run.answerText) {
      throw new Error(`Run ${run.id} (${run.provider.name}) has no stored answerText - cannot reprocess without retrieval.`);
    }
  }

  const beforeHistoricalCount = await prisma.factDetection.count({
    where: { experimentRunId: { in: runs.map((r) => r.id) } },
  });

  type Pair = { run: (typeof runs)[number]; fact: (typeof facts)[number] };
  const pairs: Pair[] = [];
  for (const run of runs) {
    for (const fact of facts) {
      pairs.push({ run, fact });
    }
  }

  let verifierCallCount = 0;
  const results: Array<{
    provider: string;
    fact: string;
    semanticStatus: string | null;
    status: string;
    confidence: number;
    matchingExcerpt: string | null;
    justification: string | null;
    verificationStatus: "SUCCESS" | "ERROR";
    verificationErrorCategory: string | null;
    verifierRetryCount: number;
    verifierCostUsd: number | null;
  }> = [];

  await mapWithConcurrency(pairs, VERIFIER_CONCURRENCY, async ({ run, fact }) => {
    verifierCallCount++;
    // Real default verifier (no testOnlyVerify) - this makes an actual
    // paid OpenRouter call using VERIFIER_MODEL.
    const result = await semanticOnlyDetectFact(fact, run.answerText!);

    const responseCitationDomains = run.citations.map((c) => c.domain);
    const detected = result.verificationStatus === "SUCCESS" && result.status !== "NOT_FOUND";
    const sourceRelationship = !detected
      ? "NOT_APPLICABLE"
      : !fact.originalSourceDomain
        ? "SOURCE_NOT_SPECIFIED"
        : classifySourceRelationshipFromDomains(responseCitationDomains, fact.originalSourceDomain);
    const citationAttribution = !detected
      ? "NOT_APPLICABLE"
      : responseCitationDomains.length > 0
        ? "RESPONSE_LEVEL"
        : "UNKNOWN";

    await prisma.factDetection.create({
      data: {
        experimentRunId: run.id,
        factId: fact.id,
        status: result.status,
        semanticStatus: result.semanticStatus,
        confidence: result.confidence,
        matchingExcerpt: result.matchingExcerpt,
        detectionMethod: result.detectionMethod,
        detectorVersion: result.detectorVersion,
        deterministicScore: result.deterministicScore,
        semanticVerifierModel: result.semanticVerifierModel,
        semanticVerifierVersion: result.semanticVerifierVersion,
        justification: result.justification,
        sourceRelationship,
        citationAttribution,
        verificationStatus: result.verificationStatus,
        verificationErrorCategory: result.verificationErrorCategory,
        verifierRetryCount: result.verifierRetryCount,
        verifierRequestId: result.verifierRequestId,
        verifierCostUsd: result.verifierCostUsd,
        verifierInputTokens: result.verifierInputTokens,
        verifierOutputTokens: result.verifierOutputTokens,
        verifierTotalTokens: result.verifierTotalTokens,
      },
    });

    results.push({
      provider: run.provider.name,
      fact: fact.label,
      semanticStatus: result.semanticStatus,
      status: result.status,
      confidence: result.confidence,
      matchingExcerpt: result.matchingExcerpt,
      justification: result.justification,
      verificationStatus: result.verificationStatus,
      verificationErrorCategory: result.verificationErrorCategory,
      verifierRetryCount: result.verifierRetryCount,
      verifierCostUsd: result.verifierCostUsd,
    });
  });

  const afterTotalCount = await prisma.factDetection.count({
    where: { experimentRunId: { in: runs.map((r) => r.id) } },
  });
  const newRowsCount = afterTotalCount - beforeHistoricalCount;

  const totalCost = results.reduce((sum, r) => sum + (r.verifierCostUsd ?? 0), 0);
  const errors = results.filter((r) => r.verificationStatus === "ERROR");

  const matrix = await getDashboardMatrix({ mode: experiment.mode, dataOrigin: "REAL", politicianId: experiment.politicianId });

  console.log("\n=== REPORT ===");
  console.log(`1. Verifier calls made: ${verifierCallCount}`);
  console.log(`2. Total verifier cost: $${totalCost.toFixed(6)}`);
  console.log("3+4. Semantic results (provider x fact):");
  for (const r of results) {
    console.log(
      `   - ${r.provider} x "${r.fact}": ${r.semanticStatus ?? "(verification error)"} (confidence ${r.confidence.toFixed(2)})`
    );
    console.log(`       Evidence: ${r.matchingExcerpt ?? "(none)"}`);
    console.log(`       Justification: ${r.justification ?? "(none)"}`);
  }
  console.log(`5. Technical errors/retries: ${errors.length} error(s); retries: ${results.map((r) => r.verifierRetryCount).join(",")}`);
  console.log(`6. Historical detections before reprocessing (still present): ${beforeHistoricalCount}`);
  console.log(`7. New rows inserted: ${newRowsCount} (expected 12)`);
  console.log(`8. Total FactDetection rows for this experiment's runs now: ${afterTotalCount} (expected ${beforeHistoricalCount + 12})`);
  console.log("9. Updated matrix (authoritative semantic classification only):");
  for (const factId of Object.keys(matrix.cells)) {
    for (const providerId of Object.keys(matrix.cells[factId])) {
      const cell = matrix.cells[factId][providerId];
      if (!cell) continue;
      const fact = matrix.facts.find((f) => f.id === factId);
      const provider = matrix.providers.find((p) => p.id === providerId);
      console.log(
        `   - ${fact?.label} x ${provider?.name}: ${cell.latestSemanticStatus ?? cell.latestStatus} ` +
          `(currentDetector=${cell.latestClassifiedWithCurrentDetector}, observationCount=${cell.observationCount}, pendingReclassification=${cell.pendingReclassificationCount})`
      );
    }
  }

  console.log(`\nVerifier model used: ${VERIFIER_MODEL}`);
  console.log(`Detector version used: ${SEMANTIC_ONLY_DETECTOR_VERSION}`);
}

main()
  .catch((error) => {
    console.error("FAIL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
