import { prisma } from "@/lib/prisma";
import { ensureRealProviderRows } from "@/lib/providers/ensureRealProviderRows";
import { getProviderAvailability } from "@/lib/providers/registry";
import { ExperimentConfigForm } from "./ExperimentConfigForm";

// OpenRouter availability depends on runtime environment configuration
// (OPENROUTER_API_KEY may be added/removed without a rebuild) - this page
// must be evaluated per-request, never statically prerendered/cached at
// build time, or a stale availability snapshot could gate/ungate live
// execution incorrectly.
export const dynamic = "force-dynamic";

export default async function NewExperimentPage() {
  // Idempotently keep the four OpenRouter-backed LLMProvider rows in sync
  // with current adapter configuration before we list selectable providers.
  await ensureRealProviderRows();

  const providers = await prisma.lLMProvider.findMany({
    where: { active: true, kind: "REAL" },
    orderBy: { name: "asc" },
  });

  const availability = getProviderAvailability();
  const availabilityByKey = new Map(availability.map((a) => [a.providerKey, a]));
  const openRouterConfigured = availability.some(
    (a) => (a.providerKey === "openai" || a.providerKey === "gemini" || a.providerKey === "claude" || a.providerKey === "perplexity") && a.available
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New experiment</h1>
        <p className="mt-1 text-sm text-slate-600">
          Configure everything on this one page, then run it. Nothing here requires visiting
          another screen first.
        </p>
      </div>
      {!openRouterConfigured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          OpenRouter API key not configured. Live experiment execution is disabled until{" "}
          <code className="rounded bg-amber-100 px-1">OPENROUTER_API_KEY</code> is set - no mock
          data will be substituted.
        </p>
      )}
      <ExperimentConfigForm
        providers={providers}
        availability={Object.fromEntries(
          providers.map((p) => [
            p.id,
            {
              available: availabilityByKey.get(p.providerKey)?.available ?? false,
              reason: availabilityByKey.get(p.providerKey)?.reason ?? "Not configured",
            },
          ])
        )}
      />
    </div>
  );
}

