/**
 * Phase 7, step 6 — hybrid evaluation.
 *
 * Runs the full hybrid pipeline (deterministic v2 -> semantic verifier,
 * ONLY when stage 1 is inconclusive -> deterministic critical-component
 * adjudication -> final verdict) against the Phase 7 benchmark.
 *
 * This intentionally does NOT call `hybridDetectFact()` directly, because
 * that function collapses the internal 4-class raw verdict
 * (FOUND/NOT_FOUND/PARTIAL_SUPPORT/UNCERTAIN) down to the public 3-class
 * `SemanticStatus` (FOUND/NOT_FOUND/UNCERTAIN) before returning. Per the
 * Phase 7 instructions ("treat PARTIAL_SUPPORT separately if practical...
 * do not collapse everything to binary unless also reporting the full
 * multiclass results"), this script instead mirrors `hybridDetectFact`'s
 * own decision logic exactly (stage 1 first; `verifyWithMetadata` only
 * when stage 1 returns NEEDS_SEMANTIC_VERIFICATION) but reads the raw,
 * pre-collapse `finalRawStatus` from the verifier metadata for full
 * 4-class scoring, while ALSO reporting the collapsed public status
 * alongside it so the two views are both available.
 *
 * Only fixtures where stage 1 is inconclusive ever reach the verifier, so
 * only those incur API cost - this script prints exactly how many calls
 * were made and their total cost.
 *
 * Run with: npm run evaluate:hybrid (REQUIRES OPENROUTER_API_KEY; makes a
 * small number of real, paid OpenRouter calls).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

import { detectFactDeterministicV2 } from "../src/lib/detection/deterministicDetectorV2";
import { verifyWithMetadata, VERIFIER_MODEL, VERIFIER_PROMPT_VERSION } from "../src/lib/detection/verifiers/openRouterFactVerifier";
import type { ComponentAdjudication, VerifierRawStatus } from "../src/lib/detection/factVerifier";
import {
  computeMulticlassReport,
  falseFoundExamples,
  falseNotFoundExamples,
  partialSupportErrors,
  printConfusionMatrix,
  printPerClassMetrics,
  printByCategory,
  type BenchmarkFixture,
  type BenchmarkLabel,
  type PredictionRecord,
} from "./lib/evalMetrics";

const BENCHMARK_PATH = path.resolve(process.cwd(), "scripts/fixtures/phase7-benchmark.json");

interface HybridPredictionExtra {
  usedVerifier: boolean;
  collapsedPublicStatus: BenchmarkLabel | null;
  semanticRawVerdict: VerifierRawStatus | null;
  componentAdjudication: ComponentAdjudication | null;
  disagreement: boolean;
  costUsd: number | null;
}

async function predictHybrid(fixture: BenchmarkFixture): Promise<{ record: PredictionRecord; extra: HybridPredictionExtra }> {
  const stage1 = detectFactDeterministicV2({ canonicalFactText: fixture.fact, identifyingKeywords: null }, fixture.answer);

  if (stage1.status === "FOUND_DETERMINISTIC" || stage1.status === "NOT_FOUND_DETERMINISTIC") {
    const predicted: BenchmarkLabel = stage1.status === "FOUND_DETERMINISTIC" ? "FOUND" : "NOT_FOUND";
    return {
      record: { fixture, predicted, detail: `stage1 decisive (${stage1.status}, score=${stage1.score.toFixed(2)}) - no verifier call` },
      extra: {
        usedVerifier: false,
        collapsedPublicStatus: predicted,
        semanticRawVerdict: null,
        componentAdjudication: null,
        disagreement: false,
        costUsd: null,
      },
    };
  }

  // NEEDS_SEMANTIC_VERIFICATION - this is the only branch that calls the verifier.
  const meta = await verifyWithMetadata({ fact: fixture.fact, answer: fixture.answer });
  const predicted: BenchmarkLabel = (meta.finalRawStatus as BenchmarkLabel | null) ?? "UNCERTAIN";

  return {
    record: {
      fixture,
      predicted,
      detail:
        `stage1=NEEDS_SEMANTIC_VERIFICATION (score=${stage1.score.toFixed(2)}) -> semanticRaw=${meta.llmRawStatus} ` +
        `componentAdjudication=${meta.componentAdjudication} finalRaw=${meta.finalRawStatus} publicStatus=${meta.result.status}`,
    },
    extra: {
      usedVerifier: true,
      collapsedPublicStatus: meta.result.status,
      semanticRawVerdict: meta.llmRawStatus,
      componentAdjudication: meta.componentAdjudication,
      disagreement: meta.disagreement,
      costUsd: meta.costUsd,
    },
  };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY is not configured - cannot make live verifier calls for the hybrid evaluation.");
  }

  const { fixtures } = JSON.parse(fs.readFileSync(BENCHMARK_PATH, "utf-8")) as { fixtures: BenchmarkFixture[] };

  console.log(`Hybrid evaluation against ${fixtures.length} benchmark fixtures.`);
  console.log(`Verifier model: ${VERIFIER_MODEL} (prompt version ${VERIFIER_PROMPT_VERSION})`);
  console.log("Only fixtures where deterministic v2 is inconclusive will incur a verifier call.\n");

  const results: { record: PredictionRecord; extra: HybridPredictionExtra }[] = [];
  for (const fixture of fixtures) {
    results.push(await predictHybrid(fixture));
  }

  const predictions = results.map((r) => r.record);
  const report = computeMulticlassReport(predictions);

  const verifierCalls = results.filter((r) => r.extra.usedVerifier);
  const totalCost = verifierCalls.reduce((sum, r) => sum + (r.extra.costUsd ?? 0), 0);
  const costUnknownCount = verifierCalls.filter((r) => r.extra.costUsd === null).length;

  console.log(`Overall accuracy: ${(report.accuracy * 100).toFixed(1)}% (${Math.round(report.accuracy * report.n)}/${report.n})\n`);

  console.log("Confusion matrix (rows = human ground truth, columns = predicted; full 4-class RAW verdict, pre public-collapse):");
  printConfusionMatrix(report);
  console.log();

  console.log("Per-class precision / recall / F1 (multiclass, 4 labels, raw finalVerdict):");
  printPerClassMetrics(report);
  console.log();

  // Also report against the collapsed PUBLIC status (what production would actually show, 3 classes).
  const collapsedPredictions: PredictionRecord[] = results.map((r) => ({
    fixture: r.record.fixture,
    predicted: r.extra.collapsedPublicStatus ?? "UNCERTAIN",
    detail: r.record.detail,
  }));
  const collapsedReport = computeMulticlassReport(collapsedPredictions);
  console.log(
    `For reference, accuracy against the COLLAPSED PUBLIC status (PARTIAL_SUPPORT -> UNCERTAIN, what production would ` +
      `actually display): ${(collapsedReport.accuracy * 100).toFixed(1)}% (${Math.round(collapsedReport.accuracy * collapsedReport.n)}/${collapsedReport.n})\n`
  );

  console.log("Accuracy by category (raw finalVerdict):");
  printByCategory(report);
  console.log();

  const falseFound = falseFoundExamples(predictions);
  const falseNotFound = falseNotFoundExamples(predictions);
  const partialErrors = partialSupportErrors(predictions);

  console.log(`False FOUND (predicted FOUND, human says otherwise) - MOST SERIOUS error class: ${falseFound.length}`);
  for (const p of falseFound) {
    console.log(`  [${p.fixture.id}] (${p.fixture.category}) human=${p.fixture.humanLabel} | ${p.detail}`);
    console.log(`    fact: ${p.fixture.fact}`);
    console.log(`    answer: ${p.fixture.answer.slice(0, 160)}${p.fixture.answer.length > 160 ? "..." : ""}`);
  }
  console.log(`\nFalse NOT_FOUND (predicted NOT_FOUND, human says FOUND): ${falseNotFound.length}`);
  for (const p of falseNotFound) {
    console.log(`  [${p.fixture.id}] (${p.fixture.category}) | ${p.detail}`);
  }
  console.log(`\nPARTIAL_SUPPORT-involved errors: ${partialErrors.length}`);
  for (const p of partialErrors) {
    console.log(`  [${p.fixture.id}] (${p.fixture.category}) human=${p.fixture.humanLabel} predicted=${p.predicted} | ${p.detail}`);
  }

  // Item 8 - verifier disagreement analysis (semanticRawVerdict != componentAdjudication).
  console.log(`\n${"=".repeat(90)}\nVerifier disagreement analysis (semanticRawVerdict != componentAdjudication):`);
  const withComponentOpinion = verifierCalls.filter((r) => r.extra.componentAdjudication !== "NOT_INFORMATIVE" && r.extra.componentAdjudication !== null);
  const disagreements = withComponentOpinion.filter((r) => r.extra.semanticRawVerdict !== r.extra.componentAdjudication);
  console.log(
    `Cases where the component layer had an informative opinion: ${withComponentOpinion.length}/${verifierCalls.length} verifier calls.`
  );
  console.log(`Of those, semanticRawVerdict != componentAdjudication in ${disagreements.length} case(s).`);
  let disagreementsCorrect = 0;
  let disagreementsIncorrect = 0;
  for (const r of disagreements) {
    const correct = r.record.predicted === r.record.fixture.humanLabel;
    if (correct) disagreementsCorrect++;
    else disagreementsIncorrect++;
    console.log(
      `  [${r.record.fixture.id}] (${r.record.fixture.category}) semanticRaw=${r.extra.semanticRawVerdict} ` +
        `componentAdjudication=${r.extra.componentAdjudication} -> finalRaw=${r.record.predicted} ` +
        `human=${r.record.fixture.humanLabel} => ${correct ? "CORRECT" : "INCORRECT"}`
    );
  }
  const agreements = withComponentOpinion.filter((r) => r.extra.semanticRawVerdict === r.extra.componentAdjudication);
  const agreementsCorrect = agreements.filter((r) => r.record.predicted === r.record.fixture.humanLabel).length;
  console.log(
    `\nWhen the two signals AGREED (${agreements.length} case(s)): ${agreementsCorrect}/${agreements.length} correct ` +
      `(${(agreements.length ? (agreementsCorrect / agreements.length) * 100 : 0).toFixed(1)}%).`
  );
  console.log(
    `When the two signals DISAGREED (${disagreements.length} case(s)): ${disagreementsCorrect}/${disagreements.length} correct ` +
      `(${(disagreements.length ? (disagreementsCorrect / disagreements.length) * 100 : 0).toFixed(1)}%).`
  );
  console.log(
    disagreements.length > 0 && disagreementsCorrect / disagreements.length >= (agreements.length ? agreementsCorrect / agreements.length : 0)
      ? "=> Disagreement-triggered adjudication appears to IMPROVE or maintain accuracy relative to agreement cases in this benchmark."
      : "=> Disagreement-triggered adjudication appears to REDUCE accuracy relative to agreement cases in this benchmark - worth further investigation."
  );

  console.log(`\n${"=".repeat(90)}`);
  console.log(`Total verifier calls made: ${verifierCalls.length} (out of ${fixtures.length} fixtures; the rest were resolved by deterministic v2 alone at zero cost).`);
  console.log(
    `Total verifier cost: $${totalCost.toFixed(6)}${costUnknownCount > 0 ? ` (cost unknown/unreported for ${costUnknownCount} call(s), not included in this total)` : ""}`
  );
  console.log("No production detection logic (hybridDetectFact / runExperimentCore.ts) was modified or invoked by this script.");
}

main();
