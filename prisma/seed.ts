import { prisma } from "../src/lib/prisma";
import { runSingleExperiment } from "../src/lib/experiment/runExperimentCore";
import { MockChatGPTProvider } from "../src/lib/providers/mock/MockChatGPTProvider";
import { MockGeminiProvider } from "../src/lib/providers/mock/MockGeminiProvider";
import { MockClaudeProvider } from "../src/lib/providers/mock/MockClaudeProvider";
import { MockPerplexityProvider } from "../src/lib/providers/mock/MockPerplexityProvider";
import { PROVIDER_REGISTRY } from "../src/lib/providers/registry";

/** Simulated dates on which the (mock) experiment was "run", spread across
 * the demo timeline so the dashboard has real first-checked / first-detected
 * history to show, rather than a single snapshot. */
const CHECK_DATES = [
  new Date("2026-08-01T09:00:00Z"),
  new Date("2026-09-01T09:00:00Z"),
  new Date("2026-09-11T09:00:00Z"), // "today"
];

async function main() {
  console.log("Seeding database...");

  await prisma.factDetection.deleteMany();
  await prisma.citation.deleteMany();
  await prisma.experimentRun.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.fact.deleteMany();
  await prisma.researchPrompt.deleteMany();
  await prisma.lLMProvider.deleteMany();
  await prisma.politician.deleteMany();

  // --- Politicians (fictional) ------------------------------------------
  const jane = await prisma.politician.create({
    data: {
      name: "Jane Smith",
      party: "Independent",
      office: "Ward Councillor, Greenford",
      country: "United Kingdom",
      notes: "Fictional politician used for demo/testing purposes only.",
    },
  });

  const daniel = await prisma.politician.create({
    data: {
      name: "Daniel Rahman",
      party: "Civic Alliance",
      office: "Member of Parliament, Elmsworth",
      country: "United Kingdom",
      notes: "Fictional politician used for demo/testing purposes only.",
    },
  });

  // --- Facts --------------------------------------------------------------
  const factYouthTrust = await prisma.fact.create({
    data: {
      politicianId: jane.id,
      label: "Youth Trust patron",
      canonicalFactText:
        "Jane Smith became patron of Greenford Youth Trust in September 2026.",
      originalSourceUrl: "https://greenfordyouthtrust.org/news/jane-smith-patron",
      originalSourceDomain: "greenfordyouthtrust.org",
      originalSourceCategory: "COMMUNITY_ORGANISATION",
      identifyingKeywords: "Greenford Youth Trust,patron",
      publishedAt: new Date("2026-09-01T00:00:00Z"),
      status: "PUBLISHED",
    },
  });

  const factCommunitySurgery = await prisma.fact.create({
    data: {
      politicianId: jane.id,
      label: "Community surgery launch",
      canonicalFactText:
        "Jane Smith launched a monthly community surgery on Greenford High Street in August 2026.",
      originalSourceUrl: "https://janesmith.org.uk/updates/community-surgery",
      originalSourceDomain: "janesmith.org.uk",
      originalSourceCategory: "OFFICIAL_WEBSITE",
      identifyingKeywords: "community surgery,Greenford High Street",
      publishedAt: new Date("2026-08-10T00:00:00Z"),
      status: "PUBLISHED",
    },
  });

  const factClimatePanel = await prisma.fact.create({
    data: {
      politicianId: jane.id,
      label: "Climate panel chair",
      canonicalFactText:
        "Jane Smith will chair the Greenford Climate Action Panel starting November 2026.",
      originalSourceUrl: "https://greenfordgazette.co.uk/jane-smith-climate-panel",
      originalSourceDomain: "greenfordgazette.co.uk",
      originalSourceCategory: "LOCAL_NEWS",
      identifyingKeywords: "Climate Action Panel,chair",
      publishedAt: new Date("2026-11-01T00:00:00Z"),
      status: "PRE_PUBLICATION",
    },
  });

  const factRentersBill = await prisma.fact.create({
    data: {
      politicianId: daniel.id,
      label: "Renters Rights Bill",
      canonicalFactText:
        "Daniel Rahman sponsored the Elmsworth Renters' Rights Bill in July 2026.",
      originalSourceUrl:
        "https://parliament.example.gov/bills/elmsworth-renters-rights",
      originalSourceDomain: "parliament.example.gov",
      originalSourceCategory: "PARLIAMENTARY_RECORD",
      identifyingKeywords: "Renters Rights Bill,sponsored",
      publishedAt: new Date("2026-07-15T00:00:00Z"),
      status: "PUBLISHED",
    },
  });

  const factFoodBank = await prisma.fact.create({
    data: {
      politicianId: daniel.id,
      label: "Food bank partnership post",
      canonicalFactText:
        "Daniel Rahman announced a new food bank partnership on his verified social media account in August 2026.",
      originalSourceUrl: "https://twitter.example/danielrahmanmp/status/123456",
      originalSourceDomain: "twitter.example",
      originalSourceCategory: "SOCIAL_MEDIA",
      identifyingKeywords: "food bank partnership",
      publishedAt: new Date("2026-08-20T00:00:00Z"),
      status: "PUBLISHED",
    },
  });

  const factHeritageSociety = await prisma.fact.create({
    data: {
      politicianId: daniel.id,
      label: "Heritage Society honorary member",
      canonicalFactText:
        "Daniel Rahman joined the Elmsworth Heritage Society as an honorary member in October 2026.",
      originalSourceUrl: "https://elmsworthheritage.org/news/honorary-member",
      originalSourceDomain: "elmsworthheritage.org",
      originalSourceCategory: "COMMUNITY_ORGANISATION",
      identifyingKeywords: "Heritage Society,honorary member",
      publishedAt: new Date("2026-10-05T00:00:00Z"),
      status: "PRE_PUBLICATION",
    },
  });

  // --- Research prompts -----------------------------------------------
  const janePrompts = await Promise.all([
    prisma.researchPrompt.create({
      data: {
        politicianId: jane.id,
        text: "What local organisations is Jane Smith involved with?",
        promptType: "GENERAL",
      },
    }),
    prisma.researchPrompt.create({
      data: {
        politicianId: jane.id,
        text: "What has Jane Smith been doing in Greenford recently?",
        promptType: "GENERAL",
      },
    }),
    prisma.researchPrompt.create({
      data: {
        politicianId: jane.id,
        text: "Does Jane Smith hold any leadership roles outside of her official council duties?",
        promptType: "INDIRECT",
      },
    }),
  ]);

  const danielPrompts = await Promise.all([
    prisma.researchPrompt.create({
      data: {
        politicianId: daniel.id,
        text: "What legislation has Daniel Rahman worked on recently?",
        promptType: "DIRECTED",
      },
    }),
    prisma.researchPrompt.create({
      data: {
        politicianId: daniel.id,
        text: "What is Daniel Rahman doing to support his local community?",
        promptType: "GENERAL",
      },
    }),
    prisma.researchPrompt.create({
      data: {
        politicianId: daniel.id,
        text: "Has Daniel Rahman been involved in any community or charity initiatives?",
        promptType: "INDIRECT",
      },
    }),
  ]);

  // --- LLM providers (mock) -----------------------------------------------
  const providerRows = await Promise.all(
    [
      MockChatGPTProvider,
      MockGeminiProvider,
      MockClaudeProvider,
      MockPerplexityProvider,
    ].map((adapter) =>
      prisma.lLMProvider.create({
        data: {
          name: adapter.displayName,
          model: adapter.model,
          providerKey: adapter.providerKey,
          searchEnabled: adapter.supportsCitations,
        },
      })
    )
  );

  console.log(
    `Created ${providerRows.length} providers, 2 politicians, 6 facts, ${
      janePrompts.length + danielPrompts.length
    } prompts.`
  );
  console.log(
    "Registered adapters:",
    Object.keys(PROVIDER_REGISTRY).join(", ")
  );

  // --- Simulated historical experiment runs -------------------------------
  const janeFacts = [factYouthTrust, factCommunitySurgery, factClimatePanel];
  const danielFacts = [factRentersBill, factFoodBank, factHeritageSociety];
  // Open-ended experiments never monitor PRE_PUBLICATION facts - those must
  // remain undiscoverable regardless of how the provider is prompted.
  const janeOpenEndedFacts = [factYouthTrust, factCommunitySurgery];
  const danielOpenEndedFacts = [factRentersBill, factFoodBank];

  // Broad, general prompts for OPEN_ENDED_DISCOVERY - deliberately avoid any
  // wording that would count as "topically directed" toward a specific fact.
  const janeOpenEndedPrompt = await prisma.researchPrompt.create({
    data: { politicianId: jane.id, text: "Tell me about Jane Smith.", promptType: "GENERAL" },
  });
  const danielOpenEndedPrompt = await prisma.researchPrompt.create({
    data: { politicianId: daniel.id, text: "Tell me about Daniel Rahman.", promptType: "GENERAL" },
  });

  const janeExperiment = await prisma.experiment.create({
    data: {
      name: "Jane Smith — targeted retrieval",
      politicianId: jane.id,
      mode: "TARGETED_RETRIEVAL",
      repetitions: CHECK_DATES.length,
      status: "COMPLETED",
      facts: { create: janeFacts.map((f) => ({ factId: f.id })) },
      prompts: { create: janePrompts.map((p) => ({ promptId: p.id })) },
      providers: { create: providerRows.map((p) => ({ providerId: p.id })) },
    },
  });

  const danielExperiment = await prisma.experiment.create({
    data: {
      name: "Daniel Rahman — targeted retrieval",
      politicianId: daniel.id,
      mode: "TARGETED_RETRIEVAL",
      repetitions: CHECK_DATES.length,
      status: "COMPLETED",
      facts: { create: danielFacts.map((f) => ({ factId: f.id })) },
      prompts: { create: danielPrompts.map((p) => ({ promptId: p.id })) },
      providers: { create: providerRows.map((p) => ({ providerId: p.id })) },
    },
  });

  const janeOpenEndedExperiment = await prisma.experiment.create({
    data: {
      name: "Jane Smith — open-ended discovery",
      politicianId: jane.id,
      mode: "OPEN_ENDED_DISCOVERY",
      repetitions: CHECK_DATES.length,
      status: "COMPLETED",
      facts: { create: janeOpenEndedFacts.map((f) => ({ factId: f.id })) },
      prompts: { create: [{ promptId: janeOpenEndedPrompt.id }] },
      providers: { create: providerRows.map((p) => ({ providerId: p.id })) },
    },
  });

  const danielOpenEndedExperiment = await prisma.experiment.create({
    data: {
      name: "Daniel Rahman — open-ended discovery",
      politicianId: daniel.id,
      mode: "OPEN_ENDED_DISCOVERY",
      repetitions: CHECK_DATES.length,
      status: "COMPLETED",
      facts: { create: danielOpenEndedFacts.map((f) => ({ factId: f.id })) },
      prompts: { create: [{ promptId: danielOpenEndedPrompt.id }] },
      providers: { create: providerRows.map((p) => ({ providerId: p.id })) },
    },
  });

  const batchIdTargeted = `seed-targeted-${Date.now()}`;
  const batchIdOpenEnded = `seed-open-ended-${Date.now()}`;
  let runCount = 0;

  for (const [dateIndex, occurredAt] of CHECK_DATES.entries()) {
    for (const provider of providerRows) {
      for (const prompt of janePrompts) {
        await runSingleExperiment({
          provider,
          prompt,
          candidateFacts: janeFacts,
          mode: "TARGETED_RETRIEVAL",
          experimentId: janeExperiment.id,
          batchId: batchIdTargeted,
          repetitionIndex: dateIndex,
          occurredAt,
        });
        runCount++;
      }
      for (const prompt of danielPrompts) {
        await runSingleExperiment({
          provider,
          prompt,
          candidateFacts: danielFacts,
          mode: "TARGETED_RETRIEVAL",
          experimentId: danielExperiment.id,
          batchId: batchIdTargeted,
          repetitionIndex: dateIndex,
          occurredAt,
        });
        runCount++;
      }

      // Open-ended: exactly one broad prompt per politician per provider,
      // checked against every monitored fact after the single response.
      await runSingleExperiment({
        provider,
        prompt: janeOpenEndedPrompt,
        candidateFacts: janeOpenEndedFacts,
        mode: "OPEN_ENDED_DISCOVERY",
        experimentId: janeOpenEndedExperiment.id,
        batchId: batchIdOpenEnded,
        repetitionIndex: dateIndex,
        occurredAt,
      });
      runCount++;

      await runSingleExperiment({
        provider,
        prompt: danielOpenEndedPrompt,
        candidateFacts: danielOpenEndedFacts,
        mode: "OPEN_ENDED_DISCOVERY",
        experimentId: danielOpenEndedExperiment.id,
        batchId: batchIdOpenEnded,
        repetitionIndex: dateIndex,
        occurredAt,
      });
      runCount++;
    }
  }

  console.log(`Created ${runCount} experiment runs across ${CHECK_DATES.length} check dates.`);
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
