import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  selectAuthoritativeObservations,
  CURRENT_ANALYSIS_DETECTOR_VERSION,
} from "../src/lib/detection/authoritativeDetection";
import { getDashboardMatrix } from "../src/lib/dashboard/getDashboardData";

/**
 * Phase 8 detector-versioning audit — zero-cost regression test (no
 * network/API calls of any kind). Run via `npm run test:detector-versioning`.
 *
 * Verifies that a (experimentRun, fact) pair which has been classified by
 * MORE THAN ONE detector version (e.g. a legacy deterministic row plus a
 * later semantic-only reprocessing row) is NEVER counted as two separate
 * research observations by the dashboard/analysis layer:
 *
 *   1. `selectAuthoritativeObservations` collapses two rows for the same
 *      (run, fact) pair into exactly one observation, preferring the
 *      current semantic-only detector version.
 *   2. `getDashboardMatrix` reflects that single-observation count end to
 *      end (observationCount/totalChecks/foundCount), not a doubled count.
 *   3. Historical/evidence retrieval (a raw `factDetection.findMany`) still
 *      returns BOTH rows - nothing is deleted or hidden at the database
 *      level, only de-duplicated at the analysis layer.
 *   4. A second run that has NOT yet been reprocessed with the current
 *      detector is flagged distinctly (`isCurrentDetectorVersion: false`,
 *      surfaced as `pendingReclassificationCount`), and still contributes
 *      exactly ONE observation (not zero, not two) using its historical
 *      classification as a display fallback.
 *
 * All fixtures are namespaced under "detector-versioning-test" and removed
 * in a `finally` block regardless of pass/fail.
 */

let passCount = 0;
let failCount = 0;
function check(name: string, condition: boolean, detail?: string) {
  const pass = condition;
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
  if (pass) passCount++;
  else failCount++;
}

async function main() {
  const NAMESPACE = "detector-versioning-test";

  const politician = await prisma.politician.create({
    data: { name: `${NAMESPACE}-politician-${Date.now()}` },
  });
  const fact = await prisma.fact.create({
    data: {
      politicianId: politician.id,
      label: "test fact",
      canonicalFactText: `MONITORED_FACT: ${NAMESPACE}`,
      status: "PUBLISHED",
    },
  });
  const prompt = await prisma.researchPrompt.create({
    data: { politicianId: politician.id, text: "test prompt" },
  });
  const provider = await prisma.lLMProvider.create({
    data: { providerKey: `${NAMESPACE}-provider`, name: "Detector versioning test provider", model: "test-model", kind: "MOCK" },
  });

  try {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:05:00Z");
    const t2 = new Date("2026-01-02T00:00:00Z");

    // --- Run 1: reprocessed - has BOTH a legacy deterministic row and a
    // current semantic-only row for the SAME (run, fact) pair. ---
    const run1 = await prisma.experimentRun.create({
      data: {
        providerId: provider.id,
        promptId: prompt.id,
        dataOrigin: "MOCK",
        status: "SUCCESS",
        startedAt: t0,
        answerText: "test answer 1",
        repetitionIndex: 0,
      },
    });
    const run1Historical = await prisma.factDetection.create({
      data: {
        experimentRunId: run1.id,
        factId: fact.id,
        status: "NOT_FOUND",
        confidence: 0.4,
        detectorVersion: "v1-adjacent-bigram",
        detectedAt: t0,
      },
    });
    const run1Current = await prisma.factDetection.create({
      data: {
        experimentRunId: run1.id,
        factId: fact.id,
        status: "FOUND",
        semanticStatus: "FOUND",
        verificationStatus: "SUCCESS",
        confidence: 0.9,
        detectorVersion: CURRENT_ANALYSIS_DETECTOR_VERSION,
        detectedAt: t1,
      },
    });

    // --- Run 2: NOT yet reprocessed - only a legacy deterministic row. ---
    const run2 = await prisma.experimentRun.create({
      data: {
        providerId: provider.id,
        promptId: prompt.id,
        dataOrigin: "MOCK",
        status: "SUCCESS",
        startedAt: t2,
        answerText: "test answer 2",
        repetitionIndex: 1,
      },
    });
    const run2Historical = await prisma.factDetection.create({
      data: {
        experimentRunId: run2.id,
        factId: fact.id,
        status: "UNCERTAIN",
        confidence: 0.5,
        detectorVersion: "v1-adjacent-bigram",
        detectedAt: t2,
      },
    });

    console.log("\n=== Unit: selectAuthoritativeObservations on a single reprocessed pair ===");
    const singlePairObservations = selectAuthoritativeObservations([run1Historical, run1Current]);
    check("Exactly ONE observation for a (run, fact) pair with two detector versions", singlePairObservations.length === 1);
    const singleObs = singlePairObservations[0];
    check("Primary row is the CURRENT (semantic-only) detector version", singleObs.primary.id === run1Current.id);
    check("isCurrentDetectorVersion is true", singleObs.isCurrentDetectorVersion === true);
    check("history retains BOTH rows for evidence/audit", singleObs.history.length === 2);

    console.log("\n=== Unit: selectAuthoritativeObservations on a not-yet-reprocessed pair ===");
    const pendingObservations = selectAuthoritativeObservations([run2Historical]);
    check("Exactly ONE observation for a not-yet-reprocessed pair", pendingObservations.length === 1);
    check("Falls back to the historical row as primary", pendingObservations[0].primary.id === run2Historical.id);
    check("isCurrentDetectorVersion is false (not yet reprocessed)", pendingObservations[0].isCurrentDetectorVersion === false);

    console.log("\n=== End-to-end: getDashboardMatrix never double-counts detector versions ===");
    const matrix = await getDashboardMatrix({
      mode: "TARGETED_RETRIEVAL",
      dataOrigin: "MOCK",
      politicianId: politician.id,
    });
    const cell = matrix.cells[fact.id]?.[provider.id];
    check("Dashboard cell exists for this fact x provider pair", !!cell);
    if (cell) {
      check("totalChecks == 2 (one per ExperimentRun, NOT one per FactDetection row)", cell.totalChecks === 2, `got ${cell.totalChecks}`);
      check("observationCount == 2 (one per run)", cell.observationCount === 2, `got ${cell.observationCount}`);
      check("foundCount == 1 (only run1's current classification is FOUND)", cell.foundCount === 1, `got ${cell.foundCount}`);
      check("uncertainCount == 1 (run2's historical fallback)", cell.uncertainCount === 1, `got ${cell.uncertainCount}`);
      check(
        "pendingReclassificationCount == 1 (run2 not yet reprocessed)",
        cell.pendingReclassificationCount === 1,
        `got ${cell.pendingReclassificationCount}`
      );
      check(
        "latestClassifiedWithCurrentDetector == false (latest run by time is run2, still historical)",
        cell.latestClassifiedWithCurrentDetector === false
      );
      check("latestStatus reflects run2's historical fallback (UNCERTAIN), not fabricated", cell.latestStatus === "UNCERTAIN");
      check("detectionRate == 0.5 (1 FOUND / 2 observations, not 1/4 or 1/1)", cell.detectionRate === 0.5, `got ${cell.detectionRate}`);
    }

    console.log("\n=== Historical/evidence retrieval still returns BOTH rows (nothing deleted/hidden in the DB) ===");
    const rawRun1Detections = await prisma.factDetection.findMany({ where: { experimentRunId: run1.id } });
    check("Raw query for run1 still returns both the historical and current rows", rawRun1Detections.length === 2);
  } finally {
    await prisma.lLMProvider.delete({ where: { id: provider.id } });
    await prisma.politician.delete({ where: { id: politician.id } });
  }

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
