import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

import { prisma } from "../src/lib/prisma";
import { createAndRunExperiment } from "../src/app/experiments/new/actions";

/**
 * Phase 9 — Experiment B (TARGETED_RETRIEVAL).
 *
 * Runs the exact same production path the UI uses
 * (`createAndRunExperiment` from `src/app/experiments/new/actions.ts`),
 * which internally calls `runExperiment` -> `runSingleExperiment` for
 * every (prompt x provider x repetition) combination. No new/duplicate
 * orchestration logic is introduced here.
 *
 * User-approved inputs (verbatim):
 *   - Subject: "Andy Burnham"
 *   - Prompt: "What are the major offices and elected positions Andy
 *     Burnham has held, and when did he hold them?" (TARGETED_RETRIEVAL)
 *   - Same 3 monitored facts as Experiment A
 *   - 4 REAL providers (openai, perplexity, claude, gemini)
 *   - 3 repetitions
 *
 * Run via `npx tsx scripts/run-phase9-experiment-b.ts`.
 */

const FACT_TEXTS = [
  "Andy Burnham became Prime Minister of the United Kingdom on 20 July 2026.",
  "Andy Burnham returned to Parliament as MP for Makerfield in June 2026.",
  "Andy Burnham was elected Mayor of Greater Manchester in 2017 and was re-elected in 2021 and 2024.",
];

const PROMPT_TEXT =
  "What are the major offices and elected positions Andy Burnham has held, and when did he hold them?";

async function main() {
  const realProviders = await prisma.lLMProvider.findMany({ where: { kind: "REAL", active: true } });
  if (realProviders.length !== 4) {
    throw new Error(`Expected exactly 4 active REAL providers, found ${realProviders.length}`);
  }

  console.log("Creating and running Experiment B (TARGETED_RETRIEVAL) via the production path...");
  console.log("Providers:", realProviders.map((p) => `${p.name} (${p.providerKey})`).join(", "));

  const result = await createAndRunExperiment({
    subjectName: "Andy Burnham",
    mode: "TARGETED_RETRIEVAL",
    facts: FACT_TEXTS.map((text) => ({ text })),
    promptText: PROMPT_TEXT,
    providerIds: realProviders.map((p) => p.id),
    repetitions: 3,
  });

  if ("error" in result) {
    throw new Error(`createAndRunExperiment failed: ${result.error}`);
  }

  console.log("Experiment created and run. ID:", result.experimentId);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
