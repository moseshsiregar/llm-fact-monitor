import { prisma } from "@/lib/prisma";
import { OPENROUTER_PROVIDERS } from "./openrouter/openRouterProviders";

/**
 * Idempotently ensures the four OpenRouter-backed logical `LLMProvider` DB
 * rows exist (kind=REAL), without ever touching the mock rows created by
 * `prisma/seed.ts`. Safe to call on every page load - uses `upsert` keyed
 * on the unique `providerKey`, so re-running it just refreshes the display
 * name/model/searchEnabled snapshot rather than creating duplicates.
 *
 * Called from the New Experiment page before listing selectable providers,
 * mirroring the existing find-or-create pattern used for `Politician`.
 */
export async function ensureRealProviderRows() {
  await Promise.all(
    OPENROUTER_PROVIDERS.map((adapter) =>
      prisma.lLMProvider.upsert({
        where: { providerKey: adapter.providerKey },
        update: {
          name: adapter.displayName,
          model: adapter.model,
          searchEnabled: adapter.supportsCitations,
          kind: "REAL",
        },
        create: {
          providerKey: adapter.providerKey,
          name: adapter.displayName,
          model: adapter.model,
          searchEnabled: adapter.supportsCitations,
          kind: "REAL",
        },
      })
    )
  );
}
