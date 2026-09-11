/**
 * ONE-OFF smoke test for the OpenRouter access layer (native web search
 * forced via the `web` plugin's `engine: "native"`). Does NOT write to the
 * app database and is NOT wired into the experiment runner - this is only
 * for validating that authentication + native web search + citation
 * metadata work before any further integration.
 *
 * Usage:
 *   npm run test:openrouter -- "Who is the mayor of Bristol?"
 *   npm run test:openrouter -- "openai/gpt-4.1" "Who is the mayor of Bristol?"
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import {
  callOpenRouterNativeWebSearch,
  OpenRouterCallError,
} from "../src/lib/providers/openrouter/openRouterClient";
import { normalizeOpenRouterResponse } from "../src/lib/providers/openrouter/normalizeOpenRouterResponse";

const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

const DEFAULT_MODEL = "openai/gpt-4.1";

async function main() {
  const args = process.argv.slice(2);

  let model: string;
  let prompt: string;
  if (args.length >= 2) {
    const [firstArg, ...rest] = args;
    model = firstArg;
    prompt = rest.join(" ").trim();
  } else {
    model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
    prompt = (args[0] ?? "").trim();
  }

  if (!prompt) {
    console.error('Usage: npm run test:openrouter -- "<prompt>"');
    console.error('   or: npm run test:openrouter -- "<model>" "<prompt>"');
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set in .env.local");
    process.exit(1);
  }

  // Perplexity's web search is inherent to the model (always-on) and is not
  // a toggleable plugin - forcing plugins:[{id:"web",engine:"native"}] on
  // these models is rejected by OpenRouter's routing layer before any model
  // call is made. Omitting the plugin here does NOT invoke Exa or any other
  // fallback engine; it just lets Perplexity's own built-in search run.
  const forceNativePlugin = !model.startsWith("perplexity/");

  console.log(`Requested model: ${model}`);
  console.log(
    forceNativePlugin
      ? `Web search:      forced native (plugins: [{ id: "web", engine: "native" }])`
      : `Web search:      inherent/always-on for Perplexity models (no plugins block sent)`
  );
  console.log(`Prompt:          "${prompt}"`);
  console.log("Calling OpenRouter (ONE request)...\n");

  const start = Date.now();
  try {
    const raw = await callOpenRouterNativeWebSearch({ apiKey, model, prompt, forceNativePlugin });
    const elapsedMs = Date.now() - start;
    const result = normalizeOpenRouterResponse(model, raw);

    console.log(`--- Response (${elapsedMs}ms) ---`);
    console.log("Requested model ID:", result.requestedModel);
    console.log("Returned model ID: ", result.returnedModel ?? "(not exposed)");
    console.log("Generation/request ID:", result.requestId ?? "(not exposed)");

    console.log("\nAnswer text:\n" + (result.answerText || "(empty)"));

    console.log("\nCitations/source annotations:");
    if (result.citations.length) {
      result.citations.forEach((c, i) => {
        console.log(`  [${i + 1}] ${c.url}`);
        console.log(`      title: ${c.title ?? "(none)"}`);
        if (c.startIndex !== null || c.endIndex !== null) {
          console.log(`      span: [${c.startIndex ?? "?"}, ${c.endIndex ?? "?"}]`);
        }
        if (c.content) {
          const preview = c.content.length > 200 ? c.content.slice(0, 200) + "..." : c.content;
          console.log(`      content preview: ${preview}`);
        }
      });
    } else {
      console.log("  (none returned)");
    }

    console.log("\nUsage:", result.usage ?? "(none exposed)");

    console.log("\nRaw response (truncated):");
    const rawJson = JSON.stringify(result.raw, null, 2);
    console.log(rawJson.length > 6000 ? rawJson.slice(0, 6000) + "\n...(truncated)" : rawJson);

    process.exit(0);
  } catch (error) {
    if (error instanceof OpenRouterCallError) {
      console.error(`\nOpenRouter call failed (status ${error.status ?? "unknown"}): ${error.message}`);
      if (error.cause) console.error("Cause:", error.cause);
    } else {
      console.error("\nUnexpected error:", error);
    }
    process.exit(1);
  }
}

main();
