import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

import { prisma } from "../src/lib/prisma";
import { detectFact } from "../src/lib/detection/detectFacts";
import { hybridDetectFact } from "../src/lib/detection/hybridDetectFact";

/**
 * Phase 5, Part D.3 + Part E — fixture-based validation of the improved
 * deterministic detector, using the four REAL answers already stored from
 * the approved Andy Burnham pilot (experiment `cmtwyegqi000eo1zw7abk75y8`).
 * No provider API calls are made here - this is pure local recomputation
 * against already-persisted `ExperimentRun.answerText` values, and it does
 * NOT write anything back to the database (the pilot's original
 * `FactDetection` rows are read-only ground truth for the "old" column).
 *
 * The expected ground truth below comes from manual human inspection of
 * the four answers (documented in the Phase 5 report) - it is a TEST
 * FIXTURE / validation benchmark only, never consulted by production
 * detection logic.
 */

const PILOT_EXPERIMENT_ID = "cmtwyegqi000eo1zw7abk75y8";

// Manual-inspection ground truth: every one of these 3 facts was
// substantively stated by every one of the 4 providers in the pilot.
const EXPECTED_SUBSTANTIVE_PRESENCE = true;

async function main() {
  const runs = await prisma.experimentRun.findMany({
    where: { experimentId: PILOT_EXPERIMENT_ID, status: "SUCCESS" },
    include: {
      provider: true,
      detections: { include: { fact: true } },
    },
    orderBy: { provider: { providerKey: "asc" } },
  });

  if (runs.length === 0) {
    throw new Error(
      `No SUCCESS runs found for experiment ${PILOT_EXPERIMENT_ID} - has it been deleted/moved?`
    );
  }

  console.log(`Loaded ${runs.length} stored runs for experiment ${PILOT_EXPERIMENT_ID}\n`);

  type Row = {
    provider: string;
    factLabel: string;
    oldStatus: string;
    oldConfidence: number;
    oldMethod: string;
    newStatus: string;
    newConfidence: number;
    newMethod: string;
    justification: string | null;
  };

  const rows: Row[] = [];
  let resolvedFound = 0;
  let needsSemantic = 0;
  let wrongNotFound = 0;

  for (const run of runs) {
    if (!run.answerText) continue;
    for (const oldDetection of run.detections) {
      const fact = oldDetection.fact;

      // Sanity-check: v1 result exactly as originally stored (read-only,
      // never recomputed/overwritten - just re-derived here for display
      // since v1's `detectFact` is a pure function of the same inputs).
      const v1 = detectFact(
        { canonicalFactText: fact.canonicalFactText, identifyingKeywords: fact.identifyingKeywords },
        run.answerText
      );
      if (v1.status !== oldDetection.status) {
        console.warn(
          `WARNING: recomputed v1 (${v1.status}) does not match stored v1 (${oldDetection.status}) ` +
            `for fact "${fact.label}" / ${run.provider.providerKey} - stored row is still ground truth.`
        );
      }

      const v2 = await hybridDetectFact(
        { canonicalFactText: fact.canonicalFactText, identifyingKeywords: fact.identifyingKeywords },
        run.answerText
      );

      rows.push({
        provider: run.provider.providerKey,
        factLabel: fact.label,
        oldStatus: oldDetection.status,
        oldConfidence: oldDetection.confidence,
        oldMethod: oldDetection.detectionMethod,
        newStatus: v2.status,
        newConfidence: v2.confidence,
        newMethod: v2.detectionMethod,
        justification: v2.justification,
      });

      if (EXPECTED_SUBSTANTIVE_PRESENCE) {
        if (v2.status === "FOUND") resolvedFound++;
        else if (v2.status === "UNCERTAIN") needsSemantic++;
        else wrongNotFound++;
      }
    }
  }

  console.log(
    "provider".padEnd(12) +
      "fact".padEnd(45) +
      "old".padEnd(11) +
      "new".padEnd(11) +
      "new method"
  );
  console.log("-".repeat(100));
  for (const r of rows) {
    console.log(
      r.provider.padEnd(12) +
        r.factLabel.slice(0, 42).padEnd(45) +
        `${r.oldStatus}(${r.oldConfidence})`.padEnd(11) +
        `${r.newStatus}(${r.newConfidence})`.padEnd(11) +
        r.newMethod
    );
  }

  console.log("\nSummary (ground truth: all 3 facts substantively present in all 4 answers):");
  console.log(`  Resolved FOUND by deterministic stage 1 alone: ${resolvedFound}`);
  console.log(`  Honestly flagged as needing semantic verification (UNCERTAIN): ${needsSemantic}`);
  console.log(`  WRONGLY reported NOT_FOUND (regression - should be 0): ${wrongNotFound}`);

  if (wrongNotFound > 0) {
    console.error("\nFAIL: deterministic v2 produced a false NOT_FOUND against known ground truth.");
    process.exitCode = 1;
  } else {
    console.log("\nPASS: no false NOT_FOUND regressions. Remaining UNCERTAIN cases genuinely need stage 2.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
