import { prisma } from "@/lib/prisma";
import { getProviderAdapter } from "@/lib/providers/registry";
import { semanticOnlyDetectFact, type SemanticOnlyDetectFactOptions } from "@/lib/detection/semanticOnlyDetectFact";
import { classifySourceRelationshipFromDomains, extractDomain } from "@/lib/detection/sourceRelationship";
import { ProviderCallError } from "@/lib/providers/types";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { ExperimentMode, Fact, LLMProvider, ResearchPrompt } from "@prisma/client";

/** Bounded technical retries for transient failures (rate limit, timeout,
 * provider outage) - Section 15. A retry obtains one valid observation for
 * the SAME `repetitionIndex`; it must never be counted as an additional
 * research repetition. */
const MAX_TECHNICAL_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

/** Phase 8 Section 9 - conservative bounded concurrency for semantic
 * verifier calls (deliberately NOT hundreds of simultaneous judge calls).
 * Configurable via env, clamped to the spec's suggested 2-4 range. */
const VERIFIER_CONCURRENCY = Math.min(4, Math.max(2, Number(process.env.VERIFIER_CONCURRENCY) || 3));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


export interface RunSingleExperimentOptions {
  provider: LLMProvider;
  prompt: ResearchPrompt;
  /** Facts this run is checked against.
   * - TARGETED_RETRIEVAL: the researcher-selected fact set for the prompt.
   * - OPEN_ENDED_DISCOVERY: every monitored fact for the politician. These
   *   facts are NEVER included in `prompt.text` sent to the provider - they
   *   are only used to scan the response after the fact. */
  candidateFacts: Fact[];
  /** Which research mode this run belongs to. Defaults to TARGETED_RETRIEVAL
   * to match all pre-existing call sites/historical data. */
  mode?: ExperimentMode;
  /** Parent Experiment configuration, if launched from the experiment
   * wizard. Omitted for ad-hoc/seed runs. */
  experimentId?: string;
  batchId?: string;
  repetitionIndex?: number;
  /** Overrides the run's timestamps. Used by the seed script to backfill
   * historical runs; real/live runs simply omit this and use "now". */
  occurredAt?: Date;
  /** TEST-ONLY hook (Phase 8 Section 16) - lets production-path tests
   * inject a mocked semantic-verifier response so the full
   * `runSingleExperiment` pipeline can be exercised end-to-end without ever
   * calling the real OpenRouter API. Production callers must never set
   * this; it is undefined on every real code path. */
  testOnlyVerify?: SemanticOnlyDetectFactOptions["verify"];
}

/**
 * The single orchestration path shared by the seed script, the experiment
 * wizard, and real provider integrations: call the provider adapter,
 * persist the raw answer + citations, run semantic-only fact verification
 * against every candidate fact, and persist the detections.
 *
 * For OPEN_ENDED_DISCOVERY, `candidateFacts` may contain several facts even
 * though only ONE provider call is made here - the same response is simply
 * checked against every monitored fact, producing multiple FactDetection
 * rows for a single ExperimentRun. This function never makes more than one
 * `adapter.runPrompt()` call.
 *
 * Phase 8: the provider's answer is persisted to `ExperimentRun` BEFORE any
 * semantic verifier call is made (Section 2 - verification must happen
 * strictly after the answer has been returned AND persisted). Verifier
 * calls for the candidate facts run with bounded concurrency
 * (`VERIFIER_CONCURRENCY`) rather than sequentially or all-at-once.
 * Classification is semantic-only (`semanticOnlyDetectFact`) - deterministic
 * v2 is never a fast path and never overrides the semantic verdict
 * (Section 14); it is only recorded as non-authoritative audit metadata.
 *
 * Citation integrity (research integrity requirement): mock providers (and
 * most real search-enabled LLM APIs) only return response-level citations -
 * a list of sources for the whole answer, not a mapping from individual
 * claims to individual sources. We therefore never pick "the" citation that
 * supports a specific fact. Each FactDetection instead records
 * `citationAttribution` honestly (RESPONSE_LEVEL / UNKNOWN / NOT_APPLICABLE)
 * and `sourceRelationship` is derived from ALL of the response's citation
 * domains, not from one arbitrarily chosen citation.
 */
export async function runSingleExperiment(options: RunSingleExperimentOptions) {
  const {
    provider,
    prompt,
    candidateFacts,
    mode = "TARGETED_RETRIEVAL",
    experimentId,
    batchId,
    repetitionIndex = 0,
  } = options;
  const occurredAt = options.occurredAt ?? new Date();
  const adapter = getProviderAdapter(provider.providerKey);

  const run = await prisma.experimentRun.create({
    data: {
      providerId: provider.id,
      promptId: prompt.id,
      experimentId,
      mode,
      dataOrigin: provider.kind,
      batchId,
      repetitionIndex,
      status: "RUNNING",
      startedAt: occurredAt,
    },
  });

  let retryCount = 0;

  // One genuine observation for this `repetitionIndex`, retried a bounded
  // number of times ONLY for transient technical failures (Section 15/10).
  // A retry never creates a new ExperimentRun/repetition - it just attempts
  // to obtain a valid result for this same run.
  for (;;) {
    try {
      const response = await adapter.runPrompt(prompt.text);

      const citations = await Promise.all(
        response.citations.map((c) => {
          const domain = extractDomain(c.url);
          return prisma.citation.create({
            data: {
              experimentRunId: run.id,
              url: c.url,
              domain,
              title: c.title,
              spanKind: c.spanKind,
              startIndex: c.startIndex ?? null,
              endIndex: c.endIndex ?? null,
              citedText: c.citedText,
              rawUrl: c.rawUrl,
              resolvedUrl: c.resolvedUrl,
              createdAt: occurredAt,
            },
          });
        })
      );
      const responseCitationDomains = citations.map((c) => c.domain);

      if (response.searchQueries?.length) {
        await Promise.all(
          response.searchQueries.map((query, sequence) =>
            prisma.searchQuery.create({
              data: {
                experimentRunId: run.id,
                query,
                sequence,
                provider: provider.providerKey,
                createdAt: occurredAt,
              },
            })
          )
        );
      }

      // Persist the provider's answer + run metadata BEFORE running any
      // semantic verification (Phase 8 Section 2). The monitored facts
      // never influenced this response - it was already fully retrieved.
      const completedRun = await prisma.experimentRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCESS",
          answerText: response.answerText,
          rawResponse: JSON.stringify(response.rawResponse ?? null),
          modelSnapshot: response.model,
          returnedModel: response.returnedModel,
          upstreamProvider: response.upstreamProvider,
          surface: response.surface,
          accessLayer: response.accessLayer ?? "NONE",
          searchMechanism: response.searchMechanism ?? "NONE",
          webSearchEnabled: response.webSearchEnabled,
          providerApi: response.providerApi,
          providerRequestId: response.providerRequestId,
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
          totalTokens: response.usage?.totalTokens,
          searchRequestCount: response.usage?.searchRequests,
          providerCost: response.usage?.cost,
          retryCount,
          completedAt: occurredAt,
        },
      });

      // Semantic-only verification for every candidate fact, bounded
      // concurrency (Section 9) - never sequential-per-fact, never
      // hundreds simultaneously.
      await mapWithConcurrency(candidateFacts, VERIFIER_CONCURRENCY, async (fact) => {
        const result = await semanticOnlyDetectFact(fact, response.answerText, {
          verify: options.testOnlyVerify,
        });

        // A technical verification failure tells us nothing about whether
        // the fact was actually supported - source/citation attribution
        // must not be inferred from it (Section 6).
        const detected = result.verificationStatus === "SUCCESS" && result.status !== "NOT_FOUND";

        // Source metadata is optional at fact-entry time. If the researcher
        // never registered an original source, we cannot compare it against
        // the response's citations - say so honestly rather than guessing.
        const sourceRelationship = !detected
          ? "NOT_APPLICABLE"
          : !fact.originalSourceDomain
            ? "SOURCE_NOT_SPECIFIED"
            : classifySourceRelationshipFromDomains(responseCitationDomains, fact.originalSourceDomain);

        // Honest attribution: we never claim a specific citation supports a
        // specific fact unless the provider gives claim-level evidence tied
        // back to this exact detection (not currently wired - citations may
        // individually be CLAIM_LEVEL, but we don't yet match a detection's
        // matched text against a citation's span). `citationId` is
        // deliberately left null.
        const citationAttribution = !detected
          ? "NOT_APPLICABLE"
          : responseCitationDomains.length > 0
            ? "RESPONSE_LEVEL"
            : "UNKNOWN";

        await prisma.factDetection.create({
          data: {
            experimentRunId: run.id,
            factId: fact.id,
            status: result.status,
            semanticStatus: result.semanticStatus,
            confidence: result.confidence,
            matchingExcerpt: result.matchingExcerpt,
            detectionMethod: result.detectionMethod,
            detectorVersion: result.detectorVersion,
            deterministicScore: result.deterministicScore,
            semanticVerifierModel: result.semanticVerifierModel,
            semanticVerifierVersion: result.semanticVerifierVersion,
            justification: result.justification,
            sourceRelationship,
            citationAttribution,
            verificationStatus: result.verificationStatus,
            verificationErrorCategory: result.verificationErrorCategory,
            verifierRetryCount: result.verifierRetryCount,
            verifierRequestId: result.verifierRequestId,
            verifierCostUsd: result.verifierCostUsd,
            verifierInputTokens: result.verifierInputTokens,
            verifierOutputTokens: result.verifierOutputTokens,
            verifierTotalTokens: result.verifierTotalTokens,
            detectedAt: occurredAt,
          },
        });
      });

      return completedRun;
    } catch (error) {
      const callError = error instanceof ProviderCallError ? error : null;
      if (callError?.retryable && retryCount < MAX_TECHNICAL_RETRIES) {
        retryCount += 1;
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1));
        continue;
      }

      return prisma.experimentRun.update({
        where: { id: run.id },
        data: {
          status: "ERROR",
          errorMessage: error instanceof Error ? error.message : String(error),
          errorCategory: callError?.category ?? "UNKNOWN",
          retryCount,
          completedAt: occurredAt,
        },
      });
    }
  }
}


