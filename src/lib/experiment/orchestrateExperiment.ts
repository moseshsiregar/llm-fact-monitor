import { prisma } from "@/lib/prisma";
import { runSingleExperiment } from "./runExperimentCore";
import type { LLMProvider, ResearchPrompt } from "@prisma/client";

/** Maximum number of live provider calls in flight at once. Deliberately
 * conservative (Section 11) - configurable via env var for future increase
 * without a code change. */
const DEFAULT_MAX_CONCURRENT_RUNS = 2;

function getMaxConcurrentRuns(): number {
  const raw = process.env.MAX_CONCURRENT_EXPERIMENT_RUNS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_RUNS;
}

interface RunTask {
  prompt: ResearchPrompt;
  provider: LLMProvider;
  repetitionIndex: number;
}

/**
 * Runs `tasks` with at most `limit` running concurrently. Each task's
 * failure is already isolated inside `runSingleExperiment` (it returns an
 * ERROR-status run rather than throwing), so this just needs to keep a
 * bounded number of workers pulling from a shared queue - it does not need
 * its own try/catch per task.
 */
async function runWithBoundedConcurrency(
  tasks: RunTask[],
  limit: number,
  execute: (task: RunTask) => Promise<{ status: string }>
): Promise<boolean> {
  let hadError = false;
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      const result = await execute(tasks[index]);
      if (result.status === "ERROR") hadError = true;
    }
  }

  const workerCount = Math.min(limit, tasks.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return hadError;
}

/**
 * Higher-level orchestration: loads a fully-configured `Experiment` (its
 * politician, monitored facts, prompts, providers and repetition count) and
 * executes every (prompt x provider x repetition) combination through the
 * existing `runSingleExperiment` - the provider abstraction and detection
 * pipeline are unchanged.
 *
 * For OPEN_ENDED_DISCOVERY experiments this still results in exactly ONE
 * `adapter.runPrompt()` call per (prompt, provider, repetition): the single
 * general-purpose prompt is sent once, and its response is checked against
 * every monitored fact inside `runSingleExperiment`. We never fan out to one
 * API call per fact.
 *
 * Calls run with bounded concurrency (Section 11, default 2, configurable
 * via `MAX_CONCURRENT_EXPERIMENT_RUNS`) rather than fully sequentially or
 * fully in parallel. Per-run failure isolation is unchanged: one provider's
 * failure never aborts the others (see `runSingleExperiment`, which always
 * resolves to a SUCCESS or ERROR run rather than throwing).
 */
export async function runExperiment(experimentId: string) {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      facts: { include: { fact: true } },
      prompts: { include: { prompt: true } },
      providers: { include: { provider: true } },
    },
  });

  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  const candidateFacts = experiment.facts.map((f) => f.fact);
  const prompts = experiment.prompts.map((p) => p.prompt);
  const providers = experiment.providers.map((p) => p.provider);

  if (candidateFacts.length === 0) throw new Error("Experiment has no monitored facts");
  if (prompts.length === 0) throw new Error("Experiment has no prompts");
  if (providers.length === 0) throw new Error("Experiment has no providers");

  await prisma.experiment.update({
    where: { id: experiment.id },
    data: { status: "RUNNING" },
  });

  const tasks: RunTask[] = [];
  for (const prompt of prompts) {
    for (const provider of providers) {
      for (let repetitionIndex = 0; repetitionIndex < experiment.repetitions; repetitionIndex++) {
        tasks.push({ prompt, provider, repetitionIndex });
      }
    }
  }

  let hadError = false;

  try {
    hadError = await runWithBoundedConcurrency(tasks, getMaxConcurrentRuns(), (task) =>
      runSingleExperiment({
        provider: task.provider,
        prompt: task.prompt,
        candidateFacts,
        mode: experiment.mode,
        experimentId: experiment.id,
        batchId: experiment.id,
        repetitionIndex: task.repetitionIndex,
      })
    );
  } finally {
    await prisma.experiment.update({
      where: { id: experiment.id },
      data: { status: hadError ? "ERROR" : "COMPLETED" },
    });
  }

  return experiment.id;
}

