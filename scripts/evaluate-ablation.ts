/**
 * Phase 7.1 — ablation evaluation for the redesigned Rule C replacement.
 *
 * Compares FOUR systems against the same frozen 84-fixture Phase 7
 * benchmark, using a SINGLE pass of real semantic-verifier calls (one per
 * fixture, ALL 84 - not just the deterministic-inconclusive subset, so
 * "semantic judge alone" can be scored on the full benchmark too) whose
 * raw output is then reused locally, at zero additional cost, to compute
 * all four systems' predictions:
 *
 *   1. Deterministic v2 only        - `detectFactDeterministicV2()` alone.
 *   2. Semantic judge alone         - the semantic verifier's raw verdict,
 *                                     for EVERY fixture, with NO
 *                                     deterministic gate and NO component
 *                                     adjudication layer at all.
 *   3. Semantic + Rule A/B only     - deterministic v2 gate (matching
 *                                     production `hybridDetectFact`
 *                                     behavior), then for the
 *                                     stage-1-inconclusive subset, ONLY
 *                                     Rule A (contradiction -> NOT_FOUND)
 *                                     and Rule B (bag-of-words guard) are
 *                                     applied - no Case 1-4 logic.
 *   4. Semantic + redesigned        - deterministic v2 gate, then the full
 *      adjudication                  Phase 7.1 `adjudicateFinalVerdict()`
 *                                     (Case 1-4, materiality-weighted) for
 *                                     the stage-1-inconclusive subset.
 *
 * Systems 1/3/4 share the exact same stage-1 deterministic gate (a fixture
 * resolved decisively by stage 1 gets the identical prediction in all
 * three) - they differ ONLY in what happens for the fixtures where stage 1
 * is inconclusive. System 2 deliberately ignores the stage-1 gate
 * entirely, to answer "how would the semantic judge alone perform with no
 * deterministic support at all".
 *
 * Per the Phase 7.1 instructions: if the redesigned adjudication layer
 * performs worse than the raw semantic judge overall, it must NOT be kept
 * merely because it is theoretically elegant - this script prints the
 * explicit comparison and a production-gate recommendation.
 *
 * Run with: npm run evaluate:ablation (REQUIRES OPENROUTER_API_KEY; makes
 * up to 84 real, paid, but very cheap OpenRouter calls - one per fixture).
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
  collapsePredictionTo3Class,
  type BenchmarkFixture,
  type BenchmarkLabel,
  type PredictionRecord,
  type MulticlassReport,
} from "./lib/evalMetrics";

const BENCHMARK_PATH = path.resolve(process.cwd(), "scripts/fixtures/phase7-benchmark.json");

/** Safety-critical categories per the Phase 7.1 production gate - these
 * must show no regressions (especially no new false FOUNDs) before any
 * production wiring is considered. */
const SAFETY_CRITICAL_CATEGORIES = new Set([
  "exact_date",
  "negation",
  "contradiction",
  "same_entities_wrong_relationship",
  "same_event_wrong_year",
  "same_year_wrong_event",
]);

/**
 * Isolated ablation-only variant of the adjudication combinator that keeps
 * ONLY Rule A (contradiction) and Rule B (bag-of-words guard), with no
 * Case 1-4 materiality logic at all - used exclusively to measure how much
 * of the redesigned system's effect comes from Rule A/B alone vs. the new
 * Case-based logic. Deliberately NOT exported from production source; this
 * is evaluation-only code.
 */
function adjudicateRuleABOnly(llmRawStatus: VerifierRawStatus, componentChecks: CriticalComponentCheckResult[]): VerifierRawStatus {
  if (componentChecks.some((c) => c.status === "CONTRADICTED")) return "NOT_FOUND"; // Rule A
  if (componentChecks.length === 0) return llmRawStatus; // Rule E equivalent - defer
  const allMatched = componentChecks.every((c) => c.status === "MATCHED");
  if (allMatched) {
    if (llmRawStatus === "FOUND" || llmRawStatus === "PARTIAL_SUPPORT") return "FOUND"; // Rule B
    return "UNCERTAIN"; // Rule B guard
  }
  return llmRawStatus; // no Case 1-4 adjustment at all - pass through unchanged
}

interface FixtureResult {
  fixture: BenchmarkFixture;
  stage1Decisive: boolean;
  stage1Label: BenchmarkLabel | null;
  llmRawStatus: VerifierRawStatus;
  llmConfidence: number;
  criticalComponents: CriticalComponentCheckResult[];
  componentAdjudication: string | null;
  redesignedFinalRaw: VerifierRawStatus;
  redesignedDisagreement: boolean;
  costUsd: number | null;
}

async function evaluateFixture(fixture: BenchmarkFixture): Promise<FixtureResult> {
  const stage1 = detectFactDeterministicV2({ canonicalFactText: fixture.fact, identifyingKeywords: null }, fixture.answer);
  const stage1Decisive = stage1.status === "FOUND_DETERMINISTIC" || stage1.status === "NOT_FOUND_DETERMINISTIC";
  const stage1Label: BenchmarkLabel | null = stage1Decisive
    ? stage1.status === "FOUND_DETERMINISTIC"
      ? "FOUND"
      : "NOT_FOUND"
    : null;

  // Called for EVERY fixture (not gated by stage1) so "semantic alone" can
  // be scored on the full 84-fixture benchmark.
  const meta = await verifyWithMetadata({ fact: fixture.fact, answer: fixture.answer });

  return {
    fixture,
    stage1Decisive,
    stage1Label,
    llmRawStatus: (meta.llmRawStatus ?? "UNCERTAIN") as VerifierRawStatus,
    llmConfidence: meta.result.confidence,
    criticalComponents: meta.criticalComponents,
    componentAdjudication: meta.componentAdjudication,
    redesignedFinalRaw: (meta.finalRawStatus ?? "UNCERTAIN") as VerifierRawStatus,
    redesignedDisagreement: meta.disagreement,
    costUsd: meta.costUsd,
  };
}

interface SystemReport {
  name: string;
  predictions: PredictionRecord[];
  report4: MulticlassReport;
  report3: MulticlassReport;
  falseFound: number;
  falseNotFound: number;
}

function buildSystemReport(name: string, predictions: PredictionRecord[]): SystemReport {
  const report4 = computeMulticlassReport(predictions);
  // Phase 7.2 bug fix: use the shared `collapsePredictionTo3Class` helper,
  // which collapses BOTH the predicted label AND the ground-truth
  // humanLabel consistently. The original Phase 7.1 version of this
  // function only collapsed `p.predicted`, leaving `p.fixture.humanLabel`
  // uncollapsed - see `evalMetrics.ts` for the full explanation of why that
  // silently produced an impossible (lower-than-4-class) 3-class accuracy.
  const collapsedPredictions: PredictionRecord[] = predictions.map(collapsePredictionTo3Class);
  const report3 = computeMulticlassReport(collapsedPredictions);
  return {
    name,
    predictions,
    report4,
    report3,
    falseFound: falseFoundExamples(predictions).length,
    falseNotFound: falseNotFoundExamples(predictions).length,
  };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY is not configured - cannot make live verifier calls for the ablation evaluation.");
  }

  const { fixtures } = JSON.parse(fs.readFileSync(BENCHMARK_PATH, "utf-8")) as { fixtures: BenchmarkFixture[] };

  console.log(`Phase 7.1 ablation evaluation against ${fixtures.length} benchmark fixtures.`);
  console.log(`Verifier model: ${VERIFIER_MODEL} (prompt version ${VERIFIER_PROMPT_VERSION})`);
  console.log("The semantic verifier is called ONCE per fixture (all 84) - its raw output is then reused locally for all 4 systems.\n");

  const results: FixtureResult[] = [];
  for (const fixture of fixtures) {
    results.push(await evaluateFixture(fixture));
  }

  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  console.log(`Total verifier calls: ${results.length}. Total cost: $${totalCost.toFixed(6)}.\n`);

  // --- System 1: Deterministic v2 only -------------------------------------
  const detPredictions: PredictionRecord[] = results.map((r) => ({
    fixture: r.fixture,
    predicted: r.stage1Decisive ? r.stage1Label! : "UNCERTAIN",
    detail: r.stage1Decisive ? "stage1 decisive" : "stage1 inconclusive -> UNCERTAIN (deterministic-only has no verifier)",
  }));

  // --- System 2: Semantic judge alone (no gate, no adjudication) -----------
  const semanticAlonePredictions: PredictionRecord[] = results.map((r) => ({
    fixture: r.fixture,
    predicted: r.llmRawStatus as BenchmarkLabel,
    detail: `semantic raw verdict (no deterministic gate, no adjudication) = ${r.llmRawStatus}`,
  }));

  // --- System 3: Semantic + Rule A/B only, deterministic-gated -------------
  const ruleABPredictions: PredictionRecord[] = results.map((r) => {
    if (r.stage1Decisive) {
      return { fixture: r.fixture, predicted: r.stage1Label!, detail: "stage1 decisive" };
    }
    const predicted = adjudicateRuleABOnly(r.llmRawStatus, r.criticalComponents) as BenchmarkLabel;
    return { fixture: r.fixture, predicted, detail: `Rule A/B only: semanticRaw=${r.llmRawStatus} -> ${predicted}` };
  });

  // --- System 4: Semantic + redesigned Case 1-4 adjudication ---------------
  const redesignedPredictions: PredictionRecord[] = results.map((r) => {
    if (r.stage1Decisive) {
      return { fixture: r.fixture, predicted: r.stage1Label!, detail: "stage1 decisive" };
    }
    return {
      fixture: r.fixture,
      predicted: r.redesignedFinalRaw as BenchmarkLabel,
      detail: `semanticRaw=${r.llmRawStatus} componentAdjudication=${r.componentAdjudication} -> finalRaw=${r.redesignedFinalRaw}`,
    };
  });

  const systems = [
    buildSystemReport("1. Deterministic v2 only", detPredictions),
    buildSystemReport("2. Semantic judge alone", semanticAlonePredictions),
    buildSystemReport("3. Semantic + Rule A/B only", ruleABPredictions),
    buildSystemReport("4. Semantic + redesigned adjudication", redesignedPredictions),
  ];

  console.log(`${"=".repeat(100)}\nPER-SYSTEM DETAIL\n${"=".repeat(100)}`);
  for (const sys of systems) {
    console.log(`\n${"-".repeat(90)}\n${sys.name}\n${"-".repeat(90)}`);
    console.log(
      `4-class accuracy: ${(sys.report4.accuracy * 100).toFixed(1)}% (${Math.round(sys.report4.accuracy * sys.report4.n)}/${sys.report4.n}) | ` +
        `3-class collapsed accuracy: ${(sys.report3.accuracy * 100).toFixed(1)}% | macro F1 (4-class): ${sys.report4.macroF1.toFixed(3)} | ` +
        `false FOUND: ${sys.falseFound} | false NOT_FOUND: ${sys.falseNotFound}`
    );
    console.log("Confusion matrix (4-class, raw):");
    printConfusionMatrix(sys.report4);
    console.log("Per-class metrics (4-class, raw):");
    printPerClassMetrics(sys.report4);
    console.log("Accuracy by category (4-class, raw):");
    printByCategory(sys.report4);
  }

  // --- Ablation table -------------------------------------------------------
  console.log(`\n${"=".repeat(100)}\nABLATION TABLE\n${"=".repeat(100)}`);
  const header = ["System", "4-cls Acc", "3-cls Acc", "Macro F1", "False FOUND", "False NOT_FOUND"];
  console.log(header.map((h) => h.padEnd(26)).join(""));
  for (const sys of systems) {
    console.log(
      [
        sys.name,
        `${(sys.report4.accuracy * 100).toFixed(1)}%`,
        `${(sys.report3.accuracy * 100).toFixed(1)}%`,
        sys.report4.macroF1.toFixed(3),
        String(sys.falseFound),
        String(sys.falseNotFound),
      ]
        .map((v) => v.padEnd(26))
        .join("")
    );
  }

  // --- Disagreement vs agreement-case accuracy (System 4 only, matching the
  // original Phase 7 methodology: semanticRawVerdict vs componentAdjudication,
  // restricted to the verifier-invoked subset). -----------------------------
  console.log(`\n${"=".repeat(100)}\nDISAGREEMENT-CASE VS AGREEMENT-CASE ACCURACY (System 4: Semantic + redesigned adjudication)\n${"=".repeat(100)}`);
  const verifierInvoked = results.filter((r) => !r.stage1Decisive);
  const withOpinion = verifierInvoked.filter((r) => r.componentAdjudication !== "NOT_INFORMATIVE" && r.componentAdjudication !== null);
  const disagreementFixtures = withOpinion.filter((r) => r.llmRawStatus !== r.componentAdjudication);
  const agreementFixtures = withOpinion.filter((r) => r.llmRawStatus === r.componentAdjudication);

  function accuracyFor(subset: FixtureResult[]): { correct: number; n: number } {
    let correct = 0;
    for (const r of subset) {
      if (r.redesignedFinalRaw === r.fixture.humanLabel) correct++;
    }
    return { correct, n: subset.length };
  }

  const disagreementAcc = accuracyFor(disagreementFixtures);
  const agreementAcc = accuracyFor(agreementFixtures);
  console.log(
    `Disagreement cases (semanticRawVerdict != componentAdjudication): ${disagreementAcc.correct}/${disagreementAcc.n} correct ` +
      `(${(disagreementAcc.n ? (disagreementAcc.correct / disagreementAcc.n) * 100 : 0).toFixed(1)}%). ` +
      `[Phase 7 baseline with the old blanket Rule C was 6.5% (2/31).]`
  );
  console.log(
    `Agreement cases (semanticRawVerdict == componentAdjudication): ${agreementAcc.correct}/${agreementAcc.n} correct ` +
      `(${(agreementAcc.n ? (agreementAcc.correct / agreementAcc.n) * 100 : 0).toFixed(1)}%). ` +
      `[Phase 7 baseline with the old blanket Rule C was 94.4% (17/18).]`
  );

  // --- Safety-critical category check ---------------------------------------
  console.log(`\n${"=".repeat(100)}\nSAFETY-CRITICAL CATEGORY CHECK (exact_date / negation / contradiction / wrong-relationship)\n${"=".repeat(100)}`);
  for (const sys of systems) {
    const safetyCats = sys.report4.byCategory.filter((c) => SAFETY_CRITICAL_CATEGORIES.has(c.category));
    console.log(`\n${sys.name}:`);
    for (const c of safetyCats) {
      console.log(`  ${c.category.padEnd(36)} n=${c.n.toString().padEnd(4)} accuracy=${(c.accuracy * 100).toFixed(1)}% (${c.correct}/${c.n})`);
    }
    const safetyFalseFound = falseFoundExamples(sys.predictions).filter((p) => SAFETY_CRITICAL_CATEGORIES.has(p.fixture.category)).length;
    console.log(`  False FOUND within safety-critical categories: ${safetyFalseFound}`);
  }

  // --- Production gate recommendation ---------------------------------------
  console.log(`\n${"=".repeat(100)}\nPRODUCTION GATE\n${"=".repeat(100)}`);
  const semanticAlone = systems[1];
  const redesigned = systems[3];
  const ruleABOnly = systems[2];

  const improvesOverSemanticAlone4 = redesigned.report4.accuracy > semanticAlone.report4.accuracy;
  const improvesOverSemanticAlone3 = redesigned.report3.accuracy > semanticAlone.report3.accuracy;
  const improvesOverRuleABOnly = redesigned.report4.accuracy > ruleABOnly.report4.accuracy;
  const falseFoundLow = redesigned.falseFound <= semanticAlone.falseFound;
  const disagreementImproved = disagreementAcc.n > 0 && disagreementAcc.correct / disagreementAcc.n > 2 / 31;

  console.log(`Redesigned (4-class) accuracy ${(redesigned.report4.accuracy * 100).toFixed(1)}% vs semantic-alone ${(semanticAlone.report4.accuracy * 100).toFixed(1)}% -> ${improvesOverSemanticAlone4 ? "IMPROVES" : "DOES NOT IMPROVE"}`);
  console.log(`Redesigned (3-class collapsed) accuracy ${(redesigned.report3.accuracy * 100).toFixed(1)}% vs semantic-alone ${(semanticAlone.report3.accuracy * 100).toFixed(1)}% -> ${improvesOverSemanticAlone3 ? "IMPROVES" : "DOES NOT IMPROVE"}`);
  console.log(`Redesigned vs Rule A/B only (isolating the new Case 1-4 logic's own contribution): ${(redesigned.report4.accuracy * 100).toFixed(1)}% vs ${(ruleABOnly.report4.accuracy * 100).toFixed(1)}% -> ${improvesOverRuleABOnly ? "IMPROVES" : "DOES NOT IMPROVE"}`);
  console.log(`False FOUND count: redesigned=${redesigned.falseFound} vs semantic-alone=${semanticAlone.falseFound} -> ${falseFoundLow ? "OK (not worse)" : "WORSE - CONCERN"}`);
  console.log(`Disagreement-case accuracy improved substantially over the old 6.5% baseline: ${disagreementImproved ? "YES" : "NO"}`);

  const allGatesPassed = improvesOverSemanticAlone4 && falseFoundLow && disagreementImproved;
  console.log(
    `\n${allGatesPassed ? "GATE RESULT: conditions met for further production consideration (still requires explicit human sign-off before wiring)." : "GATE RESULT: NOT RECOMMENDED for production wiring yet - one or more required conditions failed. Do not wire into production."}`
  );

  console.log(`\n${"=".repeat(100)}`);
  console.log("No production detection logic (hybridDetectFact / runExperimentCore.ts) was modified or invoked by this script.");
}

main();
