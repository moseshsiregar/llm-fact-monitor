"use server";

import { prisma } from "@/lib/prisma";
import { runExperiment } from "@/lib/experiment/orchestrateExperiment";
import { getProviderAdapter } from "@/lib/providers/registry";
import type { ExperimentMode, SourceCategory } from "@prisma/client";

export interface CreateExperimentFactInput {
  text: string;
  sourceUrl?: string;
  sourceCategory?: SourceCategory;
  /** ISO date string (yyyy-mm-dd), optional. */
  publishedAt?: string;
}

export interface CreateExperimentInput {
  /** Free-text politician/subject name. The app finds-or-creates the
   * internal Politician record; the researcher never sees or manages it. */
  subjectName: string;
  mode: ExperimentMode;
  facts: CreateExperimentFactInput[];
  /** Free-text prompt. Exactly one prompt is sent per experiment - facts are
   * never inserted into it, in either mode. */
  promptText: string;
  providerIds: string[];
  repetitions: number;
}

export type CreateExperimentResult = { experimentId: string } | { error: string };

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Creates an Experiment configuration from free-text input (politician
 * name, fact statements, prompt) and immediately runs it via the shared
 * orchestration path. The researcher never interacts with the underlying
 * Politician/Fact/ResearchPrompt catalog directly - this action handles all
 * persistence internally:
 *  - Politician: found-or-created by exact (trimmed) name match.
 *  - Facts: always created fresh (never reused/deduped), so editing this
 *    experiment's inputs can never retroactively change another
 *    experiment's historical record.
 *  - Prompt: always created fresh, exactly one per experiment.
 */
export async function createAndRunExperiment(
  input: CreateExperimentInput
): Promise<CreateExperimentResult> {
  const { subjectName, mode, facts, promptText, providerIds, repetitions } = input;

  const trimmedSubject = subjectName.trim();
  if (!trimmedSubject) return { error: "Enter who you're studying." };
  if (mode !== "TARGETED_RETRIEVAL" && mode !== "OPEN_ENDED_DISCOVERY") {
    return { error: "Choose a research mode." };
  }
  const cleanFacts = facts.map((f) => ({ ...f, text: f.text.trim() })).filter((f) => f.text.length > 0);
  if (cleanFacts.length === 0) return { error: "Enter at least one fact to monitor." };
  const trimmedPrompt = promptText.trim();
  if (!trimmedPrompt) return { error: "Write a prompt to send to the models." };
  if (providerIds.length === 0) return { error: "Select at least one AI model." };
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    return { error: "Repetitions must be a positive whole number." };
  }

  // Never silently substitute a mock provider or run an unavailable one -
  // re-verify availability server-side rather than trusting client state.
  const selectedProviders = await prisma.lLMProvider.findMany({ where: { id: { in: providerIds } } });
  if (selectedProviders.length !== providerIds.length) {
    return { error: "One or more selected providers no longer exist." };
  }
  for (const provider of selectedProviders) {
    let adapter;
    try {
      adapter = getProviderAdapter(provider.providerKey);
    } catch {
      return { error: `No adapter registered for provider "${provider.name}".` };
    }
    if (!adapter.isAvailable()) {
      return { error: adapter.unavailableReason() ?? `${provider.name} is not currently available.` };
    }
  }

  // The parent Experiment's dataOrigin reflects whether EVERY selected
  // provider is REAL - it must never default to MOCK for a genuinely live
  // run (the schema-level default exists only for legacy/seeded rows).
  const experimentDataOrigin = selectedProviders.every((p) => p.kind === "REAL") ? "REAL" : "MOCK";

  const politician =
    (await prisma.politician.findFirst({ where: { name: trimmedSubject } })) ??
    (await prisma.politician.create({ data: { name: trimmedSubject } }));

  const factRows = await Promise.all(
    cleanFacts.map((f) =>
      prisma.fact.create({
        data: {
          politicianId: politician.id,
          label: f.text.length > 60 ? `${f.text.slice(0, 57)}...` : f.text,
          canonicalFactText: f.text,
          originalSourceUrl: f.sourceUrl,
          originalSourceDomain: f.sourceUrl ? extractDomain(f.sourceUrl) : undefined,
          originalSourceCategory: f.sourceCategory,
          publishedAt: f.publishedAt ? new Date(f.publishedAt) : undefined,
          status: "PUBLISHED",
        },
      })
    )
  );

  const prompt = await prisma.researchPrompt.create({
    data: {
      politicianId: politician.id,
      text: trimmedPrompt,
      promptType: mode === "OPEN_ENDED_DISCOVERY" ? "GENERAL" : "DIRECTED",
    },
  });

  const experiment = await prisma.experiment.create({
    data: {
      politicianId: politician.id,
      subjectName: trimmedSubject,
      mode,
      repetitions,
      status: "DRAFT",
      dataOrigin: experimentDataOrigin,
      facts: { create: factRows.map((f) => ({ factId: f.id })) },
      prompts: { create: [{ promptId: prompt.id }] },
      providers: { create: providerIds.map((providerId) => ({ providerId })) },
    },
  });

  try {
    await runExperiment(experiment.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to run experiment." };
  }

  return { experimentId: experiment.id };
}
