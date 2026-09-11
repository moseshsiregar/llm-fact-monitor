/**
 * Development-only smoke-test utility (Section 24). Tests ONE prompt
 * against ONE real provider adapter and prints its normalized response.
 * Does NOT write to the experiment database - use this to sanity-check an
 * adapter integration in isolation before running it through the app.
 *
 * Usage:
 *   npm run test:provider -- openai "Who is the mayor of Bristol?"
 *   npm run test:provider -- gemini "What is the capital of France?"
 *   npm run test:provider -- anthropic "..."
 *   npm run test:provider -- perplexity "..."
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { getProviderAdapter, getProviderAvailability } from "../src/lib/providers/registry";

// Also load .env.local (Next.js convention) since real API keys live there.
const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

async function main() {
  const [providerKey, ...promptParts] = process.argv.slice(2);
  const prompt = promptParts.join(" ").trim();

  if (!providerKey || !prompt) {
    console.error('Usage: npm run test:provider -- <providerKey> "<prompt>"');
    console.error("\nRegistered providers:");
    for (const p of getProviderAvailability()) {
      console.error(`  ${p.providerKey.padEnd(14)} kind=${p.kind.padEnd(4)} available=${p.available} ${p.reason ?? ""}`);
    }
    process.exit(1);
  }

  const adapter = getProviderAdapter(providerKey);

  if (!adapter.isAvailable()) {
    console.error(`Provider "${providerKey}" is not available: ${adapter.unavailableReason()}`);
    process.exit(1);
  }

  console.log(`Provider: ${adapter.displayName} (${adapter.providerKey})`);
  console.log(`Model:    ${adapter.model}`);
  console.log(`Prompt:   "${prompt}"`);
  console.log("Calling provider...\n");

  const start = Date.now();
  const response = await adapter.runPrompt(prompt);
  const elapsedMs = Date.now() - start;

  console.log(`--- Response (${elapsedMs}ms) ---`);
  console.log("Model:", response.model);
  console.log("Surface:", response.surface, "| webSearchEnabled:", response.webSearchEnabled);
  console.log("Provider API:", response.providerApi ?? "(none)");
  console.log("Provider request ID:", response.providerRequestId ?? "(none)");
  console.log("\nAnswer:\n" + response.answerText);

  console.log("\nSearch queries:");
  if (response.searchQueries?.length) {
    for (const q of response.searchQueries) console.log("  -", q);
  } else {
    console.log("  (none exposed)");
  }

  console.log("\nCitations/sources:");
  if (response.citations.length) {
    for (const c of response.citations) {
      console.log(`  [${c.spanKind}] ${c.url}${c.title ? ` — ${c.title}` : ""}`);
      if (c.citedText) console.log(`      cited text: "${c.citedText}"`);
    }
  } else {
    console.log("  (none)");
  }

  console.log("\nUsage:", response.usage ?? "(none exposed)");
  console.log("\nRaw response (truncated):");
  const rawJson = JSON.stringify(response.rawResponse, null, 2);
  console.log(rawJson.length > 4000 ? rawJson.slice(0, 4000) + "\n...(truncated)" : rawJson);

  process.exit(0);
}

main().catch((error) => {
  console.error("\nProvider call failed:");
  console.error(error);
  process.exit(1);
});
