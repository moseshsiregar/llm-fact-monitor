import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

import { verifyWithMetadata, VERIFIER_MODEL, VERIFIER_PROMPT_VERSION } from "../src/lib/detection/verifiers/openRouterFactVerifier";

/**
 * Phase 6, step 2 — run the ALREADY-BUILT `OpenRouterFactVerifier` against
 * ONLY the 3 fixture pairs prepared and approved in step 1
 * (`scripts/fixtures/phase6-verifier-fixtures.json`).
 *
 * This makes exactly 3 paid OpenRouter calls, one per fixture, and nothing
 * else:
 *  - no new retrieval/provider experiment is run;
 *  - no calls are made to OpenAI/Gemini/Claude/Perplexity retrieval
 *    endpoints (or their OpenRouter routes) - only the single fixed
 *    verifier model is called, and only via the verifier's own OpenRouter
 *    client (`openRouterJudgeClient.ts`), never the retrieval client;
 *  - the fixture pairs are read verbatim from the JSON file written in
 *    step 1 - this script does NOT recompute or regenerate the fixture
 *    set, so the exact approved fact/answer pairs are what get judged;
 *  - nothing is written to the database and no production detection code
 *    (`hybridDetectFact`, `runExperimentCore.ts`) is touched or invoked.
 */

const FIXTURES_PATH = path.resolve(process.cwd(), "scripts/fixtures/phase6-verifier-fixtures.json");

/** The raw verdicts observed in the PRIOR run (the v2-precision-aware
 * prompt + tighten-only precision layer, before this round's combined
 * semantic+component adjudication was added), keyed by providerKey - kept
 * here only for this script's own before/after reporting, not consulted by
 * the verifier itself. */
const OLD_RAW_VERDICTS: Record<string, string> = {
  claude: "NOT_FOUND",
  gemini: "FOUND",
  perplexity: "PARTIAL_SUPPORT",
};

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
  if (!fs.existsSync(FIXTURES_PATH)) {
    throw new Error(
      `Fixture file not found at ${FIXTURES_PATH}. Run "npm run prepare:verifier-fixtures" first ` +
        "(this script does not regenerate fixtures - it only judges the already-approved set)."
    );
  }

  const fixtures: VerifierFixture[] = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf-8"));

  if (fixtures.length !== 3) {
    console.warn(
      `WARNING: expected exactly 3 approved fixtures, found ${fixtures.length}. Proceeding with what's in the file.`
    );
  }

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY is not configured - cannot make live verifier calls.");
  }

  console.log(`Verifier model: ${VERIFIER_MODEL} (prompt version ${VERIFIER_PROMPT_VERSION})`);
  console.log(`Judging ${fixtures.length} fixture(s) from ${path.relative(process.cwd(), FIXTURES_PATH)}\n`);

  let totalCost = 0;
  let anyCostUnknown = false;

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    console.log(`${"=".repeat(90)}`);
    console.log(`Case ${i + 1}/${fixtures.length}`);
    console.log(`Provider whose answer is judged: ${f.providerKey}`);
    console.log(`Canonical fact: ${f.canonicalFactText}`);
    console.log(`Deterministic v2 score: ${f.deterministicScore}`);

    const meta = await verifyWithMetadata({ fact: f.canonicalFactText, answer: f.answerText });

    if (meta.costUsd !== null) {
      totalCost += meta.costUsd;
    } else {
      anyCostUnknown = true;
    }

    console.log(`Old semantic verdict (prior run, tighten-only precision layer): ${OLD_RAW_VERDICTS[f.providerKey] ?? "(unknown)"}`);
    console.log(`New semantic RAW verdict (semanticRawVerdict): ${meta.llmRawStatus ?? "(call failed)"}`);
    console.log(`Deterministic component adjudication (componentAdjudication): ${meta.componentAdjudication ?? "(n/a)"}`);
    console.log(`Final combined verdict (finalVerdict): ${meta.finalRawStatus ?? "(call failed)"}`);
    console.log(`Disagreement (semantic vs. final): ${meta.disagreement}`);
    if (meta.adjudicationReason) console.log(`Adjudication reason: ${meta.adjudicationReason}`);
    console.log(`Public collapsed verdict: ${meta.result.status}`);
    console.log(`Verifier confidence: ${meta.result.confidence}`);
    console.log(`Verbatim evidence excerpt: ${meta.result.evidenceExcerpt ?? "(none)"}`);
    console.log(`Justification: ${meta.result.justification}`);
    console.log(`Exact verifier model: ${meta.result.verifierModel} (version ${meta.result.verifierVersion})`);
    console.log(
      `Cost of this call: ${meta.costUsd !== null ? `$${meta.costUsd.toFixed(6)}` : "unknown (not reported by API)"}`
    );
    console.log(
      `Evidence excerpt substring validation: ${
        !meta.excerptHadClaim
          ? "N/A (verifier gave no excerpt)"
          : meta.excerptValid
            ? "PASSED (verbatim substring confirmed in source answer)"
            : "FAILED (claimed excerpt was not found verbatim - discarded)"
      }`
    );
    console.log(`Critical components extracted: ${meta.criticalComponents.length}`);
    for (const c of meta.criticalComponents) {
      console.log(
        `  - [${c.type}] expected="${c.expected}" -> ${c.status}` +
          (c.matchedEvidence ? ` | evidence="${c.matchedEvidence}"` : "") +
          (c.note ? ` | note: ${c.note}` : "")
      );
    }
  }

  console.log(`${"=".repeat(90)}`);
  console.log(
    `\nTotal verifier cost across ${fixtures.length} call(s): $${totalCost.toFixed(6)}` +
      (anyCostUnknown ? " (one or more calls did not report cost - total may be incomplete)" : "")
  );
  console.log(
    "\nSTOPPING HERE per Phase 6 instructions: production detection logic " +
      "(hybridDetectFact / runExperimentCore.ts) has NOT been modified or invoked."
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
