# LLM Fact Monitor

This is a research tool for studying whether and how different LLMs retrieve and surface known facts about politicians from the public web.

The system supports two research modes:

1. **Targeted Retrieval** — asks whether a known fact can be retrieved when the prompt points toward the relevant topic.
2. **Open-ended Discovery** — asks whether the fact surfaces spontaneously in a broad response such as "Tell me about X."

Monitored facts are **never sent to the tested LLMs**. They are used only after the provider's answer is returned, purely for semantic verification of that answer.

## What the system does

```
Researcher configures experiment
→ prompt sent to selected LLMs
→ each model performs native web search
→ answer + citations stored
→ semantic verifier checks monitored facts against returned answer
→ results displayed in a Facts × LLMs dashboard
```

## Supported model families

All live experiment execution is routed through a single access layer, [OpenRouter](https://openrouter.ai), configured in [src/lib/providers/openrouter/openRouterProviders.ts](src/lib/providers/openrouter/openRouterProviders.ts). Four logical providers are currently registered, each overridable via an env var:

| Provider  | Default model ID                 | Env override                 |
|-----------|-----------------------------------|-------------------------------|
| OpenAI    | `openai/gpt-4.1`                  | `OPENROUTER_OPENAI_MODEL`     |
| Gemini    | `google/gemini-3.1-flash-lite`     | `OPENROUTER_GEMINI_MODEL`     |
| Claude    | `anthropic/claude-sonnet-4.5`      | `OPENROUTER_CLAUDE_MODEL`     |
| Perplexity| `perplexity/sonar`                | `OPENROUTER_PERPLEXITY_MODEL` |

Each call forces the provider's own native web search (never a third-party fallback search engine). Perplexity's search is inherent/always-on, so the "force native" plugin is intentionally omitted for it rather than forced.

Citation behavior is provider-specific and is preserved rather than normalized away (see [src/lib/providers/openrouter/citationTrust.ts](src/lib/providers/openrouter/citationTrust.ts)):

- **OpenAI** — real character offsets into the answer text, real direct source URLs.
- **Gemini** — real character offsets, but URLs are opaque Google grounding redirect links, not the original publisher URL.
- **Claude** — real direct URLs with quoted excerpt text, but no genuine character offsets (never fabricated as `0`).
- **Perplexity** — real direct URLs, response-level only (no claim-level mapping), no character offsets.

Direct-SDK adapters for OpenAI/Gemini/Claude also exist in the codebase (`src/lib/providers/openai`, etc.) but are preserved only for comparison/smoke-testing — they are not used by any live experiment run.

## Semantic fact verification

Production fact classification is **semantic-only**: every candidate fact is checked against the provider's stored answer by a single fixed verifier model, with no deterministic keyword gate in the authoritative path. This is implemented in [src/lib/detection/semanticOnlyDetectFact.ts](src/lib/detection/semanticOnlyDetectFact.ts), wired into [src/lib/experiment/runExperimentCore.ts](src/lib/experiment/runExperimentCore.ts).

- Verifier model: `mistralai/mistral-large-2512` (default; overridable via `OPENROUTER_VERIFIER_MODEL`), called through a dedicated OpenRouter client separate from retrieval.
- Internally, the verifier returns a 4-class verdict:
  - `FOUND`
  - `PARTIAL_SUPPORT`
  - `NOT_FOUND`
  - `UNCERTAIN`

`PARTIAL_SUPPORT` is collapsed to `UNCERTAIN` in the simplified dashboard status (`FactDetection.status`), but the full 4-class verdict is preserved separately (`FactDetection.semanticStatus`) and shown in detail views, so "partial support" and "genuinely uncertain" remain distinguishable on evidence pages.

A technical verifier failure (timeout, rate limit, outage, malformed response, network, auth) is recorded as its own `verificationStatus: ERROR` state and is never persisted as a substantive `NOT_FOUND`.

Earlier deterministic (`src/lib/detection/detectFacts.ts`, `deterministicDetectorV2.ts`) and hybrid (`hybridDetectFact.ts`) detectors remain in the repository. They are retained for validation/audit and as non-authoritative metadata (`deterministicScore`) alongside every detection, but they are **not** authoritative in production — internal benchmarking found the raw semantic verdict alone outperformed every deterministic/hybrid variant tested.

## Research integrity

- Monitored facts are never included in the prompt sent to a provider.
- Provider answers are persisted to the database *before* any semantic verification call is made.
- Verifier calls happen strictly post-retrieval, using a client separate from the retrieval access layer.
- `REAL` (genuine API-backed) and `MOCK` (synthetic/demo) data are separated end-to-end — tracked on `LLMProvider.kind`, `Experiment.dataOrigin`, and `ExperimentRun.dataOrigin` — and the dashboard can filter by REAL / MOCK / ALL, with a contamination warning shown when ALL is selected.
- Historical detector versions are never overwritten; each `FactDetection` row records the exact `detectorVersion` that produced it, so past classifications remain reproducible even as detection logic evolves.
- Retries (`ExperimentRun.retryCount`, `FactDetection.verifierRetryCount`) are bounded technical retries for transient failures — they never count as an additional research repetition.

## Current architecture

- **Next.js** (App Router) + **TypeScript**, **React**
- **Tailwind CSS** for styling
- **Prisma** ORM over **SQLite** (`prisma/dev.db`, local file database)
- **OpenRouter** as the sole live model-access layer

## Getting started

```
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

You will also need a local database; see [Data and database notes](#data-and-database-notes) below.

## Environment setup

Copy `.env.example` to `.env.local` and fill in the keys you have access to. Missing keys are handled gracefully: that provider shows as "Not configured" and cannot be selected for a real experiment — the app never silently substitutes mock data for a missing real provider.

At minimum:

```
OPENROUTER_API_KEY=
```

Other variables defined in `.env.example`:

- `OPENROUTER_OPENAI_MODEL`, `OPENROUTER_GEMINI_MODEL`, `OPENROUTER_CLAUDE_MODEL`, `OPENROUTER_PERPLEXITY_MODEL` — per-family model overrides for live experiment execution.
- `MAX_CONCURRENT_EXPERIMENT_RUNS` — max simultaneous live provider calls per experiment run (default 2).
- `VERIFIER_CONCURRENCY` — max simultaneous semantic-verifier calls per provider answer (default 3, clamped 2–4).
- `OPENROUTER_VERIFIER_MODEL` — override for the semantic verifier model.
- `VERIFIER_TIMEOUT_MS` — timeout for a single verifier call before it's classified as a retryable failure (default 30000).
- `OPENAI_API_KEY`/`OPENAI_MODEL`, `GEMINI_API_KEY`/`GEMINI_MODEL`, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`, `PERPLEXITY_API_KEY`/`PERPLEXITY_MODEL` — direct-SDK keys, preserved only for the standalone comparison adapter and dev smoke tests; **not** used by live experiment execution.

**Never commit `.env.local` or API keys to GitHub.**

## Running an experiment

From the "New Experiment" page:

1. Enter the politician/subject name (free text — no picker/catalog).
2. Choose a research mode (Targeted Retrieval or Open-ended Discovery).
3. Enter one or more facts to monitor.
4. Enter the prompt to send to the models.
5. Select which AI models to run (only providers with a configured API key are selectable).
6. Choose the number of repetitions.
7. Run the experiment.
8. Inspect results in the experiment's fact × provider matrix, the run history detail page (full provenance, usage/cost, citations), or the main Dashboard.

## Costs

Both retrieval calls (to the tested LLMs) and semantic-verifier calls incur real API cost, and are tracked and displayed separately (`ExperimentRun.providerCost` vs. `FactDetection.verifierCostUsd`). Costs vary substantially across providers and models. Experiment and run-history pages surface these costs directly from stored, provider-reported figures — this repository does not hardcode or version-control any pricing tables.

## Validation

Commands defined in `package.json`:

```
npm run test:dashboard
npm run test:detector-versioning
npm run test:production-detection
npm run test:detection
npm run test:adjudication-fixtures
npm run evaluate:deterministic
npm run evaluate:hybrid
npm run evaluate:ablation
npm run evaluate:semantic-only
```

The semantic-only detector has been benchmarked internally against a fixture set (`scripts/fixtures/phase7-benchmark.json`). Be accurate about its provenance: the benchmark's ground-truth labels were **AI-agent-authored**, not independently human-labelled — this is recorded explicitly in the fixture file's own `labelSource` field. A genuine human-labelled validation set is still recommended before making any publication-grade accuracy claims.

## Data and database notes

The local SQLite database file (`prisma/dev.db`, plus its `-journal` sidecar) is explicitly **git-ignored** (see `.gitignore`). Local experiment data — including any real API-backed observations you generate — is never automatically published to GitHub; it stays only in your local `prisma/dev.db` unless you choose to export or commit it yourself.

## Repository status

The core research instrument is production-ready for local use: configurable experiments, real web-search-enabled retrieval via OpenRouter, semantic fact verification, and a Facts × LLMs dashboard all work end-to-end.

Future work may include:

- A genuine human-labelled verifier validation set.
- Data export tooling.
- Deployment (currently local-only).
- Scheduled/recurring runs.
- Citation-source analysis (e.g. resolving Gemini's redirect URLs to original publishers).
- Gemini redirect resolution (`Citation.resolvedUrl` exists in the schema but is not yet populated).

## Important wording rules

- Data about real public figures (e.g. politicians referenced in prompts or facts you configure) reflects **REAL API observations** when generated through a live, REAL-tagged experiment — this is not fictional data.
- Seed/demo data generated by `prisma/seed.ts` is **MOCK** data, produced by synthetic mock provider adapters for demonstration and UI testing — clearly separated from REAL data via `dataOrigin` throughout the schema and dashboard.
- Fixtures under `scripts/fixtures/` used for detector benchmarking are **SYNTHETIC validation fixtures** (AI-authored facts, answers, and labels) — useful for regression testing, but not a substitute for human-labelled evaluation or real-world observation.

