/**
 * Phase 7, step 5 — deterministic-only evaluation.
 *
 * Runs ONLY `detectFactDeterministicV2` (stage 1 of the hybrid pipeline)
 * against the full Phase 7 benchmark (`scripts/fixtures/phase7-benchmark.json`).
 * This makes NO network calls and costs nothing.
 *
 * A `NEEDS_SEMANTIC_VERIFICATION` stage-1 result is treated as a prediction
 * of `UNCERTAIN`, matching exactly what `hybridDetectFact` returns today in
 * production when called without a verifier (see `hybridDetectFact.ts`).
 * The deterministic stage can never predict `PARTIAL_SUPPORT` on its own -
 * this is expected and reported explicitly (see the PARTIAL_SUPPORT row of
 * the confusion matrix / per-class metrics).
 *
 * Run with: npm run evaluate:deterministic
 */
import fs from "node:fs";
import path from "node:path";
import { detectFactDeterministicV2 } from "../src/lib/detection/deterministicDetectorV2";
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

function predictDeterministic(fixture: BenchmarkFixture): PredictionRecord {
  const stage1 = detectFactDeterministicV2({ canonicalFactText: fixture.fact, identifyingKeywords: null }, fixture.answer);

  let predicted: BenchmarkLabel;
  if (stage1.status === "FOUND_DETERMINISTIC") predicted = "FOUND";
  else if (stage1.status === "NOT_FOUND_DETERMINISTIC") predicted = "NOT_FOUND";
  else predicted = "UNCERTAIN"; // NEEDS_SEMANTIC_VERIFICATION, no verifier available -> production reports UNCERTAIN

  return {
    fixture,
    predicted,
    detail: `stage1=${stage1.status} score=${stage1.score.toFixed(2)} matched=${stage1.matchedComponents.length}/${stage1.totalComponents}`,
  };
}

function main() {
  const { fixtures } = JSON.parse(fs.readFileSync(BENCHMARK_PATH, "utf-8")) as { fixtures: BenchmarkFixture[] };

  console.log(`Deterministic-only (v2) evaluation against ${fixtures.length} benchmark fixtures. No network calls, zero cost.\n`);

  const predictions = fixtures.map(predictDeterministic);
  const report = computeMulticlassReport(predictions);

  console.log(`Overall accuracy: ${(report.accuracy * 100).toFixed(1)}% (${Math.round(report.accuracy * report.n)}/${report.n})\n`);

  console.log("Confusion matrix (rows = human ground truth, columns = predicted):");
  printConfusionMatrix(report);
  console.log();

  console.log("Per-class precision / recall / F1 (multiclass, 4 labels):");
  printPerClassMetrics(report);
  console.log(
    "\nNote: deterministic v2 alone cannot predict PARTIAL_SUPPORT - any human PARTIAL_SUPPORT fixture is always " +
      "predicted as FOUND, NOT_FOUND, or UNCERTAIN, so PARTIAL_SUPPORT recall/precision above reflect that structural limitation, not a scoring bug.\n"
  );

  console.log("Accuracy by category:");
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

  // Binary views, reported alongside (not instead of) the multiclass results.
  const binaryStrict = predictions.map((p) => ({
    predictedPositive: p.predicted === "FOUND",
    actualPositive: p.fixture.humanLabel === "FOUND",
  }));
  const tpStrict = binaryStrict.filter((x) => x.predictedPositive && x.actualPositive).length;
  const fpStrict = binaryStrict.filter((x) => x.predictedPositive && !x.actualPositive).length;
  const fnStrict = binaryStrict.filter((x) => !x.predictedPositive && x.actualPositive).length;
  const precisionStrict = tpStrict / (tpStrict + fpStrict || 1);
  const recallStrict = tpStrict / (tpStrict + fnStrict || 1);
  console.log(
    `\nBinary view (positive = FOUND only, everything else negative): precision=${precisionStrict.toFixed(3)} recall=${recallStrict.toFixed(3)} ` +
      `(reported in addition to, not instead of, the multiclass results above)`
  );

  console.log(`\nTotal fixtures evaluated: ${report.n}. No API calls made, cost = $0.00.`);
}

main();
