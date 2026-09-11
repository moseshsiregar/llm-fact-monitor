/**
 * Phase 7 — shared, dependency-free scoring utilities for benchmarking the
 * deterministic-only and hybrid detection pipelines against the human
 * ground-truth benchmark (`scripts/fixtures/phase7-benchmark.json`).
 *
 * Used by both `evaluate-deterministic.ts` (zero-cost) and
 * `evaluate-hybrid.ts` (makes real, but minimal, paid verifier calls) so
 * the two reports are directly comparable.
 */

export type BenchmarkLabel = "FOUND" | "PARTIAL_SUPPORT" | "NOT_FOUND" | "UNCERTAIN";

export const ALL_LABELS: BenchmarkLabel[] = ["FOUND", "PARTIAL_SUPPORT", "NOT_FOUND", "UNCERTAIN"];

/** Phase 7.2 audit: distinguishes HOW `humanLabel` was actually produced,
 * since the benchmark file's legacy "humanLabel" field name/description
 * overstated genuine human review. None of the 84 fixtures in
 * `phase7-benchmark.json` were labelled by an independent human annotator
 * separate from the AI coding agent that authored the benchmark - see the
 * Phase 7.2 audit report for the full explanation. */
export type LabelSource =
  /** Fact/answer text is real (reused from a stored pilot experiment run),
   * but the expected label was assigned by the AI agent reading the pair -
   * not by an independent human annotator, and not derived from any
   * detector/verifier output. */
  | "AI_AGENT_LABELLED_REAL_ANSWER"
  /** Fact, answer, AND label were all authored by the AI agent as
   * synthetic validation data (fictional scenario) - no real retrieval
   * involved at all. */
  | "AI_AGENT_AUTHORED_SYNTHETIC";

export interface BenchmarkFixture {
  id: string;
  fact: string;
  answer: string;
  humanLabel: BenchmarkLabel;
  category: string;
  source: "REAL_PILOT" | "SYNTHETIC";
  notes?: string;
  /** Optional for backward compatibility with older benchmark files that
   * predate the Phase 7.2 label-provenance audit. */
  labelSource?: LabelSource;
}

export interface PredictionRecord {
  fixture: BenchmarkFixture;
  predicted: BenchmarkLabel;
  /** Free-text explanation of how this prediction was reached, for the
   * error-example sections of the report. */
  detail: string;
}

export interface ClassMetrics {
  label: BenchmarkLabel;
  support: number;
  predictedCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface CategoryMetrics {
  category: string;
  n: number;
  correct: number;
  accuracy: number;
}

export interface MulticlassReport {
  n: number;
  accuracy: number;
  confusionMatrix: Record<BenchmarkLabel, Record<BenchmarkLabel, number>>;
  perClass: ClassMetrics[];
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  byCategory: CategoryMetrics[];
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Maps a 4-class label down to the public 3-class vocabulary
 * (PARTIAL_SUPPORT collapses into UNCERTAIN; FOUND/NOT_FOUND/UNCERTAIN are
 * unchanged). */
export function collapseTo3Class(label: BenchmarkLabel): BenchmarkLabel {
  return label === "PARTIAL_SUPPORT" ? "UNCERTAIN" : label;
}

/**
 * Collapses a `PredictionRecord` to the 3-class vocabulary, applying the
 * SAME collapse to both the predicted label and the ground-truth
 * `humanLabel` consistently. This is the ONLY correct way to derive a
 * 3-class report from 4-class predictions: collapsing just one side (as
 * an earlier, buggy version of the Phase 7.1 ablation script did) silently
 * turns previously-correct PARTIAL_SUPPORT predictions into apparent
 * errors, producing a 3-class accuracy that is LOWER than the 4-class
 * accuracy it was derived from - which is mathematically impossible for a
 * deterministic, consistently-applied label collapse. Never mutates the
 * original fixture object (returns a shallow copy). */
export function collapsePredictionTo3Class(record: PredictionRecord): PredictionRecord {
  return {
    fixture: { ...record.fixture, humanLabel: collapseTo3Class(record.fixture.humanLabel) },
    predicted: collapseTo3Class(record.predicted),
    detail: record.detail,
  };
}

/** Computes the full multiclass confusion matrix, per-class precision/
 * recall/F1, macro-averaged metrics, and per-category accuracy for a set
 * of (predicted, actual) pairs. All four label values are always present
 * in the confusion matrix/per-class report (with zero counts where
 * appropriate) so, e.g., a deterministic-only system that never predicts
 * PARTIAL_SUPPORT still shows an explicit 0-recall/0-precision row rather
 * than silently omitting the class. */
export function computeMulticlassReport(predictions: PredictionRecord[]): MulticlassReport {
  const confusionMatrix = Object.fromEntries(
    ALL_LABELS.map((actual) => [actual, Object.fromEntries(ALL_LABELS.map((pred) => [pred, 0]))])
  ) as Record<BenchmarkLabel, Record<BenchmarkLabel, number>>;

  let correct = 0;
  for (const p of predictions) {
    confusionMatrix[p.fixture.humanLabel][p.predicted]++;
    if (p.predicted === p.fixture.humanLabel) correct++;
  }

  const perClass: ClassMetrics[] = ALL_LABELS.map((label) => {
    const support = predictions.filter((p) => p.fixture.humanLabel === label).length;
    const predictedCount = predictions.filter((p) => p.predicted === label).length;
    const truePositives = predictions.filter((p) => p.fixture.humanLabel === label && p.predicted === label).length;
    const falsePositives = predictedCount - truePositives;
    const falseNegatives = support - truePositives;
    const precision = safeDiv(truePositives, predictedCount);
    const recall = safeDiv(truePositives, support);
    const f1 = safeDiv(2 * precision * recall, precision + recall);
    return { label, support, predictedCount, truePositives, falsePositives, falseNegatives, precision, recall, f1 };
  });

  const macroPrecision = perClass.reduce((sum, c) => sum + c.precision, 0) / perClass.length;
  const macroRecall = perClass.reduce((sum, c) => sum + c.recall, 0) / perClass.length;
  const macroF1 = perClass.reduce((sum, c) => sum + c.f1, 0) / perClass.length;

  const categories = [...new Set(predictions.map((p) => p.fixture.category))].sort();
  const byCategory: CategoryMetrics[] = categories.map((category) => {
    const inCategory = predictions.filter((p) => p.fixture.category === category);
    const categoryCorrect = inCategory.filter((p) => p.predicted === p.fixture.humanLabel).length;
    return { category, n: inCategory.length, correct: categoryCorrect, accuracy: safeDiv(categoryCorrect, inCategory.length) };
  });

  return {
    n: predictions.length,
    accuracy: safeDiv(correct, predictions.length),
    confusionMatrix,
    perClass,
    macroPrecision,
    macroRecall,
    macroF1,
    byCategory,
  };
}

/** "False FOUND" — predicted FOUND but the human ground truth says
 * otherwise. Flagged separately and treated as the most serious error
 * class, per the Phase 7 instructions ("False FOUND should be treated as
 * particularly serious"). */
export function falseFoundExamples(predictions: PredictionRecord[]): PredictionRecord[] {
  return predictions.filter((p) => p.predicted === "FOUND" && p.fixture.humanLabel !== "FOUND");
}

/** "False negative" in the strict sense used here: the human ground truth
 * is FOUND but the system predicted NOT_FOUND (the most damaging kind of
 * miss - actively asserting the fact is unsupported when it is in fact
 * fully supported). */
export function falseNotFoundExamples(predictions: PredictionRecord[]): PredictionRecord[] {
  return predictions.filter((p) => p.predicted === "NOT_FOUND" && p.fixture.humanLabel === "FOUND");
}

/** Any case where either the human label or the prediction is
 * PARTIAL_SUPPORT and the two disagree - i.e. errors specifically
 * involving the partial-support class. */
export function partialSupportErrors(predictions: PredictionRecord[]): PredictionRecord[] {
  return predictions.filter(
    (p) =>
      p.predicted !== p.fixture.humanLabel &&
      (p.predicted === "PARTIAL_SUPPORT" || p.fixture.humanLabel === "PARTIAL_SUPPORT")
  );
}

export function printConfusionMatrix(report: MulticlassReport): void {
  const width = 16;
  const pad = (s: string) => s.padEnd(width).slice(0, width);
  console.log(`${pad("actual \\ predicted")}${ALL_LABELS.map((l) => pad(l)).join("")}`);
  for (const actual of ALL_LABELS) {
    const row = ALL_LABELS.map((pred) => pad(String(report.confusionMatrix[actual][pred]))).join("");
    console.log(`${pad(actual)}${row}`);
  }
}

export function printPerClassMetrics(report: MulticlassReport): void {
  for (const c of report.perClass) {
    console.log(
      `  ${c.label.padEnd(16)} support=${c.support.toString().padEnd(4)} precision=${c.precision.toFixed(3)} ` +
        `recall=${c.recall.toFixed(3)} f1=${c.f1.toFixed(3)}`
    );
  }
  console.log(
    `  ${"MACRO AVG".padEnd(16)} ${" ".repeat(12)}precision=${report.macroPrecision.toFixed(3)} ` +
      `recall=${report.macroRecall.toFixed(3)} f1=${report.macroF1.toFixed(3)}`
  );
}

export function printByCategory(report: MulticlassReport): void {
  for (const c of report.byCategory) {
    console.log(`  ${c.category.padEnd(36)} n=${c.n.toString().padEnd(4)} accuracy=${c.accuracy.toFixed(3)} (${c.correct}/${c.n})`);
  }
}
