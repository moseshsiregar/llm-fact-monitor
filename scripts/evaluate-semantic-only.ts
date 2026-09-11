/**
 * Phase 7.2 — audit of the semantic-only benchmark and evaluation metrics,
 * performed BEFORE any production wiring decision.
 *
 * Explicitly scoped as an AUDIT, not a redesign:
 *   - Does NOT run any new retrieval experiments (no provider/ChatGPT/
 *     Gemini/Claude/Perplexity calls - the fact/answer text for every
 *     fixture is already frozen in `phase7-benchmark.json`).
 *   - Does NOT modify production detection code (`hybridDetectFact.ts`,
 *     `runExperimentCore.ts` are never imported here).
 *   - Does NOT redesign `adjudicateFinalVerdict()` / Case 1-4 logic.
 *   - Makes exactly ONE semantic-verifier call per fixture (the same kind
 *     of "cache-building pass" explicitly permitted in Phase 7.1) and
 *     PERSISTS the raw results to `scripts/fixtures/phase7-semantic-cache.json`
 *     so future audits/re-analyses never need to pay for this again.
 *
 * Investigates and fixes a real evaluation bug found in the Phase 7.1
 * report (semantic-only 4-class accuracy 88.1% vs. collapsed 3-class
 * accuracy 73.8% - a 3-class collapse of a 4-class result can never LOWER
 * accuracy if applied consistently; see Section 1 below for the full
 * root-cause explanation and demonstration).
 *
 * Run with: npm run evaluate:semantic-only (REQUIRES OPENROUTER_API_KEY on
 * first run - makes up to 84 real, paid, but very cheap OpenRouter verifier
 * calls; subsequent runs reuse the persisted cache at zero cost unless
 * --refresh is passed).
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
import type { CriticalComponentCheckResult } from "../src/lib/detection/verifiers/criticalComponents";
import type { VerifierRawStatus } from "../src/lib/detection/factVerifier";
import {
  computeMulticlassReport,
  falseFoundExamples,
  falseNotFoundExamples,
  printConfusionMatrix,
  printPerClassMetrics,
  printByCategory,
  collapseTo3Class,
  collapsePredictionTo3Class,
  ALL_LABELS,
  type BenchmarkFixture,
  type BenchmarkLabel,
  type PredictionRecord,
} from "./lib/evalMetrics";

const BENCHMARK_PATH = path.resolve(process.cwd(), "scripts/fixtures/phase7-benchmark.json");
const CACHE_PATH = path.resolve(process.cwd(), "scripts/fixtures/phase7-semantic-cache.json");
const REFRESH = process.argv.includes("--refresh");

interface CachedFixtureResult {
  id: string;
  stage1Decisive: boolean;
  stage1Label: BenchmarkLabel | null;
  llmRawStatus: VerifierRawStatus;
  llmConfidence: number;
  evidenceExcerpt: string | null;
  justification: string;
  criticalComponents: CriticalComponentCheckResult[];
  componentAdjudication: string | null;
  finalRawStatus: VerifierRawStatus;
  costUsd: number | null;
}

interface SemanticCache {
  verifierModel: string;
  verifierPromptVersion: string;
  fixtureCount: number;
  totalCostUsd: number;
  createdAt: string;
  results: CachedFixtureResult[];
}

async function buildCache(fixtures: BenchmarkFixture[]): Promise<SemanticCache> {
  const results: CachedFixtureResult[] = [];
  for (const fixture of fixtures) {
    const stage1 = detectFactDeterministicV2({ canonicalFactText: fixture.fact, identifyingKeywords: null }, fixture.answer);
    const stage1Decisive = stage1.status === "FOUND_DETERMINISTIC" || stage1.status === "NOT_FOUND_DETERMINISTIC";
    const stage1Label: BenchmarkLabel | null = stage1Decisive ? (stage1.status === "FOUND_DETERMINISTIC" ? "FOUND" : "NOT_FOUND") : null;

    const meta = await verifyWithMetadata({ fact: fixture.fact, answer: fixture.answer });

    results.push({
      id: fixture.id,
      stage1Decisive,
      stage1Label,
      llmRawStatus: (meta.llmRawStatus ?? "UNCERTAIN") as VerifierRawStatus,
      llmConfidence: meta.result.confidence,
      evidenceExcerpt: meta.result.evidenceExcerpt,
      justification: meta.result.justification,
      criticalComponents: meta.criticalComponents,
      componentAdjudication: meta.componentAdjudication,
      finalRawStatus: (meta.finalRawStatus ?? "UNCERTAIN") as VerifierRawStatus,
      costUsd: meta.costUsd,
    });
  }
  const totalCostUsd = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  return {
    verifierModel: VERIFIER_MODEL,
    verifierPromptVersion: VERIFIER_PROMPT_VERSION,
    fixtureCount: fixtures.length,
    totalCostUsd,
    createdAt: new Date().toISOString(),
    results,
  };
}

function loadOrBuildCache(fixtures: BenchmarkFixture[]): Promise<SemanticCache> | SemanticCache {
  if (!REFRESH && fs.existsSync(CACHE_PATH)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as SemanticCache;
    if (
      cached.fixtureCount === fixtures.length &&
      cached.verifierModel === VERIFIER_MODEL &&
      cached.verifierPromptVersion === VERIFIER_PROMPT_VERSION
    ) {
      console.log(`Reusing persisted semantic-verifier cache from ${cached.createdAt} (${cached.results.length} fixtures, $${cached.totalCostUsd.toFixed(6)} original cost) - ZERO new paid calls made.\n`);
      return cached;
    }
    console.log("Cache found but stale (fixture count or verifier model/prompt version changed) - rebuilding.\n");
  }
  return buildCache(fixtures);
}

function meanConfidence(results: CachedFixtureResult[]): number {
  if (results.length === 0) return 0;
  return results.reduce((sum, r) => sum + r.llmConfidence, 0) / results.length;
}

/** Ablation-only Rule A/B combinator, duplicated from `evaluate-ablation.ts`
 * (not exported from production source - evaluation-only code) so this
 * script can recompute the corrected 3-class figures for all 4 Phase 7.1
 * systems from the SAME cached pass, at zero additional cost. */
function adjudicateRuleABOnly(llmRawStatus: VerifierRawStatus, componentChecks: CriticalComponentCheckResult[]): VerifierRawStatus {
  if (componentChecks.some((c) => c.status === "CONTRADICTED")) return "NOT_FOUND";
  if (componentChecks.length === 0) return llmRawStatus;
  const allMatched = componentChecks.every((c) => c.status === "MATCHED");
  if (allMatched) {
    if (llmRawStatus === "FOUND" || llmRawStatus === "PARTIAL_SUPPORT") return "FOUND";
    return "UNCERTAIN";
  }
  return llmRawStatus;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim() && !fs.existsSync(CACHE_PATH)) {
    throw new Error("OPENROUTER_API_KEY is not configured and no cache exists - cannot make live verifier calls for this audit.");
  }

  const { fixtures } = JSON.parse(fs.readFileSync(BENCHMARK_PATH, "utf-8")) as { fixtures: BenchmarkFixture[] };
  const fixtureById = new Map(fixtures.map((f) => [f.id, f]));

  console.log(`Phase 7.2 semantic-only audit against ${fixtures.length} benchmark fixtures.`);
  const cache = await loadOrBuildCache(fixtures);
  if (!fs.existsSync(CACHE_PATH) || REFRESH) {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
    console.log(`Persisted semantic-verifier cache to ${path.relative(process.cwd(), CACHE_PATH)} (total cost this run: $${cache.totalCostUsd.toFixed(6)}).\n`);
  }

  const semanticPredictions: PredictionRecord[] = cache.results.map((r) => ({
    fixture: fixtureById.get(r.id)!,
    predicted: r.llmRawStatus as BenchmarkLabel,
    detail: `semantic raw verdict (no deterministic gate, no adjudication) = ${r.llmRawStatus} (confidence ${r.llmConfidence.toFixed(2)})`,
  }));

  // ==========================================================================
  // SECTION 1 — diagnose and fix the 4-class vs 3-class accuracy inconsistency
  // ==========================================================================
  console.log(`${"=".repeat(100)}\nSECTION 1: 4-class vs 3-class accuracy inconsistency\n${"=".repeat(100)}`);

  console.log("\n4-class label mapping (identity - no collapsing):");
  for (const l of ALL_LABELS) console.log(`  ${l.padEnd(20)} -> ${l}`);

  console.log("\n3-class mapping applied to PREDICTED labels (collapseTo3Class):");
  for (const l of ALL_LABELS) console.log(`  ${l.padEnd(20)} -> ${collapseTo3Class(l)}`);

  console.log("\n3-class mapping applied to GROUND-TRUTH (humanLabel) labels (SAME function, collapseTo3Class):");
  for (const l of ALL_LABELS) console.log(`  ${l.padEnd(20)} -> ${collapseTo3Class(l)}`);

  const report4 = computeMulticlassReport(semanticPredictions);

  // Reproduce the ORIGINAL Phase 7.1 bug on purpose, for demonstration only:
  // collapse the predicted label but leave the ground-truth humanLabel
  // uncollapsed (this is exactly what `evaluate-ablation.ts` did before the
  // Phase 7.2 fix).
  const buggyPredictions: PredictionRecord[] = semanticPredictions.map((p) => ({
    fixture: p.fixture, // NOT collapsed - this is the bug
    predicted: collapseTo3Class(p.predicted),
    detail: p.detail,
  }));
  const report3Buggy = computeMulticlassReport(buggyPredictions);

  // The FIXED version: collapse both sides consistently.
  const correctedPredictions: PredictionRecord[] = semanticPredictions.map(collapsePredictionTo3Class);
  const report3Fixed = computeMulticlassReport(correctedPredictions);

  console.log(`\nObservations included in each metric: 4-class n=${report4.n}, buggy-3-class n=${report3Buggy.n}, fixed-3-class n=${report3Fixed.n} (all 84 - the bug is NOT a filtering/observation-count issue).`);
  console.log(`4-class accuracy:            ${(report4.accuracy * 100).toFixed(1)}% (${Math.round(report4.accuracy * report4.n)}/${report4.n})`);
  console.log(`Buggy 3-class accuracy (as originally reported in Phase 7.1): ${(report3Buggy.accuracy * 100).toFixed(1)}% (${Math.round(report3Buggy.accuracy * report3Buggy.n)}/${report3Buggy.n})`);
  console.log(`Fixed 3-class accuracy (ground truth ALSO collapsed):        ${(report3Fixed.accuracy * 100).toFixed(1)}% (${Math.round(report3Fixed.accuracy * report3Fixed.n)}/${report3Fixed.n})`);

  console.log("\nFixtures correct under 4-class but INCORRECT under the buggy 3-class collapse:");
  const brokenByBug = semanticPredictions.filter((p, i) => {
    const correct4 = p.predicted === p.fixture.humanLabel;
    const buggy = buggyPredictions[i];
    const correct3Buggy = buggy.predicted === buggy.fixture.humanLabel;
    return correct4 && !correct3Buggy;
  });
  for (const p of brokenByBug) {
    console.log(
      `  ${p.fixture.id.padEnd(12)} predicted=${p.predicted.padEnd(16)} humanLabel=${p.fixture.humanLabel.padEnd(16)} ` +
        `-> after buggy collapse: predicted=${collapseTo3Class(p.predicted).padEnd(16)} humanLabel=${p.fixture.humanLabel} (UNCOLLAPSED - the bug) => mismatch`
    );
  }
  console.log(
    `\nRoot cause: ${brokenByBug.length} fixture(s) above all have predicted === humanLabel === "PARTIAL_SUPPORT" (correct under 4-class).\n` +
      `The buggy \`buildSystemReport()\` collapsed \`predicted\` (PARTIAL_SUPPORT -> UNCERTAIN) via \`collapse3Class()\`, but reused the\n` +
      `ORIGINAL \`p.fixture\` object unmodified - so the ground truth used inside \`computeMulticlassReport()\` (\`p.fixture.humanLabel\`)\n` +
      `stayed at the uncollapsed "PARTIAL_SUPPORT". The confusion matrix then compared collapsed-predicted "UNCERTAIN" against\n` +
      `uncollapsed-actual "PARTIAL_SUPPORT" and scored it as WRONG, even though both labels represent the identical collapsed class.\n` +
      `This is exactly why the "3-class" accuracy (73.8%) was LOWER than the 4-class accuracy (88.1%) it was supposedly derived from -\n` +
      `a mathematically impossible result for a label collapse applied consistently to both sides, which is what first triggered this audit.\n` +
      `FIX APPLIED: \`scripts/lib/evalMetrics.ts\` now exports \`collapsePredictionTo3Class()\`, which collapses BOTH \`predicted\` AND\n` +
      `\`fixture.humanLabel\` together (via a shallow-copied fixture, never mutating the shared original). \`evaluate-ablation.ts\` has been\n` +
      `updated to use it. No model output was altered - only the evaluation/scoring code changed.\n` +
      `Corrected 3-class accuracy for semantic-only: ${(report3Fixed.accuracy * 100).toFixed(1)}% (this is HIGHER than the buggy 73.8%, as expected since\n` +
      `collapsing two ground-truth classes together can only ever help or leave accuracy unchanged, never hurt it).`
  );

  // ==========================================================================
  // SECTION 2 — semantic-only confusion matrix + individual error list
  // ==========================================================================
  console.log(`\n${"=".repeat(100)}\nSECTION 2: semantic-only confusion matrix (4-class, all 84 fixtures) + individual errors\n${"=".repeat(100)}`);
  printConfusionMatrix(report4);
  console.log("\nPer-class metrics:");
  printPerClassMetrics(report4);

  console.log("\nIndividual errors (predicted != humanLabel):");
  const errorRecords = cache.results.filter((r) => {
    const fixture = fixtureById.get(r.id)!;
    return r.llmRawStatus !== fixture.humanLabel;
  });
  for (const r of errorRecords) {
    const fixture = fixtureById.get(r.id)!;
    const shortExplanation = r.justification.length > 220 ? `${r.justification.slice(0, 220)}...` : r.justification;
    console.log(
      `\n  [${r.id}] category=${fixture.category}\n` +
        `    human label: ${fixture.humanLabel}  |  predicted: ${r.llmRawStatus}  |  confidence: ${r.llmConfidence.toFixed(2)}\n` +
        `    explanation: ${shortExplanation}`
    );
  }
  console.log(`\nTotal semantic-only errors: ${errorRecords.length} / ${cache.results.length}.`);

  // ==========================================================================
  // SECTION 3 — benchmark label provenance audit
  // ==========================================================================
  console.log(`\n${"=".repeat(100)}\nSECTION 3: benchmark label provenance audit\n${"=".repeat(100)}`);
  const bySource = { REAL_PILOT: 0, SYNTHETIC: 0 } as Record<string, number>;
  for (const f of fixtures) bySource[f.source] = (bySource[f.source] ?? 0) + 1;
  console.log(
    `The benchmark file's own top-level description states: "Human labels (humanLabel) are the ground truth and are assigned\n` +
      `independently of any detector/verifier output". This is TECHNICALLY true (no label was copied from a verifier's output) but\n` +
      `MISLEADING: it implies independent human review, when in fact EVERY one of the ${fixtures.length} \`humanLabel\` values in this file was\n` +
      `assigned by the AI coding agent that authored the benchmark during a prior phase, reading each fact/answer pair and judging the\n` +
      `correct label - NOT by a separate human annotator, and there is no record of the user individually reviewing/approving each of\n` +
      `the ${fixtures.length} labels line by line. None of these labels are "genuinely manually human-labelled" in the strict sense; none were\n` +
      `"derived from another system" (e.g. copied from the semantic verifier); all are AI-authored expected labels, split into two\n` +
      `provenance buckets:\n` +
      `  - REAL_PILOT (n=${bySource.REAL_PILOT ?? 0}): fact/answer TEXT is real (reused verbatim from the stored, approved Andy Burnham pilot\n` +
      `    experiment run) - but the expected LABEL was still assigned by the AI agent reading that real text, not by a human.\n` +
      `  - SYNTHETIC (n=${bySource.SYNTHETIC ?? 0}): fact, answer, AND label were ALL authored by the AI agent as validation data using a\n` +
      `    fictional scenario - no real retrieval involved at all.\n` +
      `A new \`labelSource\` field has been added to every fixture in \`phase7-benchmark.json\` (values: "AI_AGENT_LABELLED_REAL_ANSWER" /\n` +
      `"AI_AGENT_AUTHORED_SYNTHETIC") to make this honest going forward. The benchmark's misleading top-level description text has also\n` +
      `been corrected. NO \`humanLabel\` VALUE WAS CHANGED - only provenance metadata was added/corrected.`
  );

  // ==========================================================================
  // SECTION 4 — semantic-only ablation (corrected)
  // ==========================================================================
  console.log(`\n${"=".repeat(100)}\nSECTION 4: semantic-only ablation (corrected metrics)\n${"=".repeat(100)}`);
  console.log(`4-class accuracy:            ${(report4.accuracy * 100).toFixed(1)}% (${Math.round(report4.accuracy * report4.n)}/${report4.n})`);
  console.log(`Corrected 3-class accuracy:  ${(report3Fixed.accuracy * 100).toFixed(1)}% (${Math.round(report3Fixed.accuracy * report3Fixed.n)}/${report3Fixed.n})`);
  console.log(`Macro F1 (4-class):          ${report4.macroF1.toFixed(3)}`);
  console.log("\nPer-class precision/recall/F1:");
  printPerClassMetrics(report4);
  const falseFound = falseFoundExamples(semanticPredictions);
  const falseNotFound = falseNotFoundExamples(semanticPredictions);
  console.log(`\nFalse FOUND count: ${falseFound.length}`);
  for (const p of falseFound) console.log(`  ${p.fixture.id} (${p.fixture.category}): humanLabel=${p.fixture.humanLabel}, predicted=FOUND`);
  console.log(`False NOT_FOUND count: ${falseNotFound.length}`);
  for (const p of falseNotFound) console.log(`  ${p.fixture.id} (${p.fixture.category}): humanLabel=${p.fixture.humanLabel}, predicted=NOT_FOUND`);
  console.log("\nPerformance by category:");
  printByCategory(report4);
  const correctResults = cache.results.filter((r) => fixtureById.get(r.id)!.humanLabel === r.llmRawStatus);
  const incorrectResults = cache.results.filter((r) => fixtureById.get(r.id)!.humanLabel !== r.llmRawStatus);
  console.log(
    `\nMean confidence, correct predictions:   ${meanConfidence(correctResults).toFixed(3)} (n=${correctResults.length})\n` +
      `Mean confidence, incorrect predictions: ${meanConfidence(incorrectResults).toFixed(3)} (n=${incorrectResults.length})`
  );

  // ==========================================================================
  // SECTION 5 — confidence calibration
  // ==========================================================================
  console.log(`\n${"=".repeat(100)}\nSECTION 5: confidence calibration (semantic-only, no threshold tuning)\n${"=".repeat(100)}`);
  const buckets: { label: string; min: number; max: number }[] = [
    { label: "< 0.50", min: 0, max: 0.5 },
    { label: "0.50-0.59", min: 0.5, max: 0.6 },
    { label: "0.60-0.69", min: 0.6, max: 0.7 },
    { label: "0.70-0.79", min: 0.7, max: 0.8 },
    { label: "0.80-0.89", min: 0.8, max: 0.9 },
    { label: "0.90-1.00", min: 0.9, max: 1.0001 },
  ];
  for (const bucket of buckets) {
    const inBucket = cache.results.filter((r) => r.llmConfidence >= bucket.min && r.llmConfidence < bucket.max);
    if (inBucket.length === 0) {
      console.log(`  ${bucket.label.padEnd(12)} n=0`);
      continue;
    }
    const correct = inBucket.filter((r) => fixtureById.get(r.id)!.humanLabel === r.llmRawStatus).length;
    console.log(`  ${bucket.label.padEnd(12)} n=${inBucket.length.toString().padEnd(4)} accuracy=${((correct / inBucket.length) * 100).toFixed(1)}% (${correct}/${inBucket.length})`);
  }

  // ==========================================================================
  // BONUS — corrected Phase 7.1 ablation table (all 4 systems, zero new cost)
  // ==========================================================================
  console.log(`\n${"=".repeat(100)}\nBONUS: corrected Phase 7.1 ablation table (all 4 systems, recomputed from the SAME cached pass - zero new paid calls)\n${"=".repeat(100)}`);
  const detPredictions: PredictionRecord[] = cache.results.map((r) => ({
    fixture: fixtureById.get(r.id)!,
    predicted: r.stage1Decisive ? r.stage1Label! : "UNCERTAIN",
    detail: "",
  }));
  const ruleABPredictions: PredictionRecord[] = cache.results.map((r) => {
    const fixture = fixtureById.get(r.id)!;
    if (r.stage1Decisive) return { fixture, predicted: r.stage1Label!, detail: "" };
    return { fixture, predicted: adjudicateRuleABOnly(r.llmRawStatus, r.criticalComponents) as BenchmarkLabel, detail: "" };
  });
  const redesignedPredictions: PredictionRecord[] = cache.results.map((r) => {
    const fixture = fixtureById.get(r.id)!;
    if (r.stage1Decisive) return { fixture, predicted: r.stage1Label!, detail: "" };
    return { fixture, predicted: r.finalRawStatus as BenchmarkLabel, detail: "" };
  });

  const systems = [
    { name: "1. Deterministic v2 only", predictions: detPredictions },
    { name: "2. Semantic judge alone", predictions: semanticPredictions },
    { name: "3. Semantic + Rule A/B only", predictions: ruleABPredictions },
    { name: "4. Semantic + redesigned adjudication", predictions: redesignedPredictions },
  ];
  console.log("System                                  4-cls Acc   Corrected 3-cls Acc   Macro F1   False FOUND   False NOT_FOUND");
  for (const sys of systems) {
    const r4 = computeMulticlassReport(sys.predictions);
    const r3 = computeMulticlassReport(sys.predictions.map(collapsePredictionTo3Class));
    console.log(
      `${sys.name.padEnd(40)} ${`${(r4.accuracy * 100).toFixed(1)}%`.padEnd(11)} ${`${(r3.accuracy * 100).toFixed(1)}%`.padEnd(21)} ` +
        `${r4.macroF1.toFixed(3).padEnd(10)} ${String(falseFoundExamples(sys.predictions).length).padEnd(13)} ${falseNotFoundExamples(sys.predictions).length}`
    );
  }

  // ==========================================================================
  // SECTION 6 — production recommendation
  // ==========================================================================
  console.log(`\n${"=".repeat(100)}\nSECTION 6: production recommendation\n${"=".repeat(100)}`);
  const semanticReport3 = report3Fixed;
  const semanticFalseFound = falseFound.length;
  const semanticFalseNotFound = falseNotFound.length;
  console.log(
    `Corrected semantic-only figures: 4-class accuracy ${(report4.accuracy * 100).toFixed(1)}%, 3-class accuracy ${(semanticReport3.accuracy * 100).toFixed(1)}%, ` +
      `false FOUND=${semanticFalseFound}, false NOT_FOUND=${semanticFalseNotFound}.`
  );
  const clearlySuperior = [detPredictions, ruleABPredictions, redesignedPredictions].every(
    (predictions) => computeMulticlassReport(predictions).accuracy < report4.accuracy
  );
  const falseFoundLow = semanticFalseFound === 0;
  const falseNotFoundLow = semanticFalseNotFound === 0;
  console.log(`Semantic-only clearly superior to all 3 other systems (corrected figures): ${clearlySuperior ? "YES" : "NO"}`);
  console.log(`False FOUND extremely low (0): ${falseFoundLow ? "YES" : "NO"} (count=${semanticFalseFound})`);
  console.log(`False NOT_FOUND extremely low (0): ${falseNotFoundLow ? "YES" : "NO"} (count=${semanticFalseNotFound})`);
  const recommend = clearlySuperior && falseFoundLow && falseNotFoundLow;
  console.log(
    `\n${
      recommend
        ? "RECOMMENDATION: semantic-only (fixed semantic verifier, NO deterministic gate, NO component override) is recommended for Phase 8 " +
          "production wiring. Deterministic v2 and critical-component extraction should be retained ONLY as optional audit/diagnostic metadata " +
          "displayed alongside the semantic verdict - never as classification authority."
        : "RECOMMENDATION: one or more production-gate conditions failed even after correcting the evaluation bug - do NOT recommend production " +
          "wiring yet."
    }`
  );

  console.log(`\n${"=".repeat(100)}`);
  console.log("No production detection logic (hybridDetectFact / runExperimentCore.ts) was modified or invoked by this script. No new retrieval calls were made.");
}

main();
