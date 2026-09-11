import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

import { prisma } from "../src/lib/prisma";
import { hybridDetectFact } from "../src/lib/detection/hybridDetectFact";

/**
 * Phase 6, step 1 — prepare (but do NOT execute) the semantic-verifier
 * fixture set.
 *
 * This script makes ZERO calls to OpenRouter or any paid API. It only:
 *  1. Re-loads the 12 already-stored fact x answer pairs from the approved
 *     Andy Burnham pilot (experiment `cmtwyegqi000eo1zw7abk75y8`) - no new
 *     provider retrieval calls are made.
 *  2. Runs the existing deterministic v2 stage (via `hybridDetectFact`
 *     with no verifier - identical to production's current behavior) to
 *     find exactly which pairs stage 1 could NOT resolve
 *     (`status === "UNCERTAIN"`) - these are the only pairs that would
 *     ever reach the semantic verifier in production, since
 *     `hybridDetectFact` only calls stage 2 when stage 1 returns
 *     `NEEDS_SEMANTIC_VERIFICATION`.
 *  3. Writes that fixture set to `scripts/fixtures/phase6-verifier-fixtures.json`
 *     for review, and prints a summary.
 *
 * Per the Phase 6 instructions, this script intentionally STOPS here.
 * Running the actual `OpenRouterFactVerifier` against this fixture set is a
 * separate, not-yet-created step that requires explicit approval first
 * (it costs money and calls a third-party API).
 */

const PILOT_EXPERIMENT_ID = "cmtwyegqi000eo1zw7abk75y8";
const OUTPUT_PATH = path.resolve(process.cwd(), "scripts/fixtures/phase6-verifier-fixtures.json");

interface VerifierFixture {
  experimentRunId: string;
  providerKey: string;
  factId: string;
  factLabel: string;
  canonicalFactText: string;
  identifyingKeywords: string | null;
  answerText: string;
  deterministicScore: number;
  deterministicJustification: string | null;
}

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

  const fixtures: VerifierFixture[] = [];
  let totalPairs = 0;

  for (const run of runs) {
    if (!run.answerText) continue;
    for (const oldDetection of run.detections) {
      totalPairs++;
      const fact = oldDetection.fact;

      const v2 = await hybridDetectFact(
        { canonicalFactText: fact.canonicalFactText, identifyingKeywords: fact.identifyingKeywords },
        run.answerText
      );

      if (v2.status !== "UNCERTAIN") continue;

      fixtures.push({
        experimentRunId: run.id,
        providerKey: run.provider.providerKey,
        factId: fact.id,
        factLabel: fact.label,
        canonicalFactText: fact.canonicalFactText,
        identifyingKeywords: fact.identifyingKeywords,
        answerText: run.answerText,
        deterministicScore: v2.deterministicScore,
        deterministicJustification: v2.justification,
      });
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(fixtures, null, 2), "utf-8");

  console.log(`Loaded ${runs.length} stored runs, ${totalPairs} fact x answer pairs total.\n`);
  console.log(
    "provider".padEnd(14) + "fact".padEnd(45) + "deterministicScore"
  );
  console.log("-".repeat(80));
  for (const f of fixtures) {
    console.log(f.providerKey.padEnd(14) + f.factLabel.slice(0, 42).padEnd(45) + f.deterministicScore);
  }

  console.log(
    `\nPrepared ${fixtures.length}/${totalPairs} pairs needing semantic verification ` +
      `(deterministic stage 1 was decisive for the other ${totalPairs - fixtures.length}).`
  );
  console.log(`Fixture set written to ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  console.log(
    "\nSTOPPING HERE per Phase 6 instructions: no calls have been made to the semantic " +
      "verifier or any paid API. Awaiting explicit approval before running " +
      "OpenRouterFactVerifier against this fixture set."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
