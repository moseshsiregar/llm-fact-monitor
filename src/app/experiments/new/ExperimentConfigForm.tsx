"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LLMProvider, SourceCategory } from "@prisma/client";
import { createAndRunExperiment } from "./actions";

type ExperimentModeValue = "TARGETED_RETRIEVAL" | "OPEN_ENDED_DISCOVERY";

const SOURCE_CATEGORIES: { value: string; label: string }[] = [
  { value: "OFFICIAL_WEBSITE", label: "Official website" },
  { value: "LOCAL_NEWS", label: "Local news" },
  { value: "NATIONAL_NEWS", label: "National news" },
  { value: "SOCIAL_MEDIA", label: "Social media" },
  { value: "PARLIAMENTARY_RECORD", label: "Parliamentary record" },
  { value: "PARTY_WEBSITE", label: "Party website" },
  { value: "COMMUNITY_ORGANISATION", label: "Community organisation" },
  { value: "WIKIPEDIA", label: "Wikipedia" },
  { value: "OTHER", label: "Other" },
];

interface FactInput {
  key: string;
  text: string;
  sourceOpen: boolean;
  sourceUrl: string;
  sourceCategory: string;
  publishedAt: string;
}

let factKeyCounter = 0;
function newFact(): FactInput {
  factKeyCounter += 1;
  return {
    key: `fact-${factKeyCounter}`,
    text: "",
    sourceOpen: false,
    sourceUrl: "",
    sourceCategory: "",
    publishedAt: "",
  };
}

function targetedSuggestions(name: string): string[] {
  const who = name.trim() || "this person";
  return [
    `What local organisations is ${who} involved with?`,
    `What has ${who} done regarding housing?`,
    `What environmental initiatives has ${who} supported?`,
  ];
}

function openEndedSuggestions(name: string): string[] {
  const who = name.trim() || "this person";
  return [
    `Tell me about ${who}.`,
    `Who is ${who}?`,
    `Give me an overview of ${who}.`,
    `What should I know about ${who}?`,
  ];
}

export function ExperimentConfigForm({
  providers,
  availability,
}: {
  providers: LLMProvider[];
  availability: Record<string, { available: boolean; reason: string }>;
}) {
  const router = useRouter();

  const [subjectName, setSubjectName] = useState("");
  const [mode, setMode] = useState<ExperimentModeValue>("TARGETED_RETRIEVAL");
  const [facts, setFacts] = useState<FactInput[]>([newFact()]);
  const [promptText, setPromptText] = useState("");
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(
    new Set(providers.filter((p) => availability[p.id]?.available).map((p) => p.id))
  );
  const [repetitions, setRepetitions] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () => (mode === "TARGETED_RETRIEVAL" ? targetedSuggestions(subjectName) : openEndedSuggestions(subjectName)),
    [mode, subjectName]
  );

  const nonEmptyFacts = facts.filter((f) => f.text.trim().length > 0);
  const expectedCalls = selectedProviderIds.size * Math.max(repetitions, 0) * 1;

  function updateFact(key: string, patch: Partial<FactInput>) {
    setFacts((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  function addFact() {
    setFacts((prev) => [...prev, newFact()]);
  }

  function removeFact(key: string) {
    setFacts((prev) => (prev.length <= 1 ? prev : prev.filter((f) => f.key !== key)));
  }

  function toggleProvider(id: string) {
    if (!availability[id]?.available) return;
    setSelectedProviderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function validate(): string | null {
    if (!subjectName.trim()) return "Enter who you're studying.";
    if (nonEmptyFacts.length === 0) return "Enter at least one fact to monitor.";
    if (!promptText.trim()) return "Write a prompt to send to the models.";
    if (selectedProviderIds.size === 0) return "Select at least one AI model.";
    if (!Number.isInteger(repetitions) || repetitions < 1) return "Repetitions must be a positive whole number.";
    return null;
  }

  async function handleSubmit() {
    const blocker = validate();
    if (blocker) {
      setError(blocker);
      return;
    }
    setError(null);
    setSubmitting(true);

    const result = await createAndRunExperiment({
      subjectName: subjectName.trim(),
      mode,
      facts: nonEmptyFacts.map((f) => ({
        text: f.text.trim(),
        sourceUrl: f.sourceOpen && f.sourceUrl.trim() ? f.sourceUrl.trim() : undefined,
        sourceCategory: f.sourceOpen && f.sourceCategory ? (f.sourceCategory as SourceCategory) : undefined,
        publishedAt: f.sourceOpen && f.publishedAt ? f.publishedAt : undefined,
      })),
      promptText: promptText.trim(),
      providerIds: Array.from(selectedProviderIds),
      repetitions,
    });

    setSubmitting(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    router.push(`/experiments/${result.experimentId}`);
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Section title="Who are we studying?">
        <input
          type="text"
          value={subjectName}
          onChange={(e) => setSubjectName(e.target.value)}
          placeholder="e.g. Jane Smith"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">Politician / public figure. No need to select from a list.</p>
      </Section>

      <Section title="Research mode">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ModeCard
            title="Targeted retrieval"
            description="Can the model find the information when we ask about its subject?"
            selected={mode === "TARGETED_RETRIEVAL"}
            onClick={() => setMode("TARGETED_RETRIEVAL")}
          />
          <ModeCard
            title="Open-ended discovery"
            description="Does the information surface naturally when we simply ask about the politician?"
            selected={mode === "OPEN_ENDED_DISCOVERY"}
            onClick={() => setMode("OPEN_ENDED_DISCOVERY")}
          />
        </div>
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {mode === "OPEN_ENDED_DISCOVERY"
            ? "The facts below are monitored after the response is returned. They are never included in the prompt sent to the AI."
            : "Write a question that points toward the subject of the facts without stating the facts themselves."}
        </p>
      </Section>

      <Section title="Facts to monitor">
        <div className="flex flex-col gap-3">
          {facts.map((f, i) => (
            <div key={f.key} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-2 text-xs font-medium text-slate-400">{i + 1}.</span>
                <textarea
                  value={f.text}
                  onChange={(e) => updateFact(f.key, { text: e.target.value })}
                  rows={2}
                  placeholder="e.g. Jane Smith became patron of Greenford Youth Trust in September 2026."
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => removeFact(f.key)}
                  disabled={facts.length <= 1}
                  className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:text-red-600 disabled:opacity-30"
                  aria-label="Remove fact"
                >
                  Remove
                </button>
              </div>

              <button
                onClick={() => updateFact(f.key, { sourceOpen: !f.sourceOpen })}
                className="ml-6 mt-2 text-xs font-medium text-slate-500 underline"
              >
                {f.sourceOpen ? "− Hide source information" : "+ Add original source information"}
              </button>

              {f.sourceOpen && (
                <div className="ml-6 mt-2 grid grid-cols-1 gap-2 rounded-md bg-slate-50 p-3 md:grid-cols-3">
                  <div>
                    <label className="text-xs text-slate-500">Original source URL</label>
                    <input
                      type="text"
                      value={f.sourceUrl}
                      onChange={(e) => updateFact(f.key, { sourceUrl: e.target.value })}
                      placeholder="https://example.com/article"
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Source category</label>
                    <select
                      value={f.sourceCategory}
                      onChange={(e) => updateFact(f.key, { sourceCategory: e.target.value })}
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">Not specified</option>
                      {SOURCE_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Publication date</label>
                    <input
                      type="date"
                      value={f.publishedAt}
                      onChange={(e) => updateFact(f.key, { publishedAt: e.target.value })}
                      className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addFact}
          className="mt-3 text-sm font-medium text-slate-700 underline"
        >
          + Add another fact
        </button>
      </Section>

      <Section title="Prompt">
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={3}
          placeholder="Write the exact question to send to the models…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setPromptText(s)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {s}
            </button>
          ))}
        </div>
      </Section>

      <Section title="AI models">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {providers.map((p) => {
            const info = availability[p.id];
            const available = info?.available ?? false;
            return (
              <label
                key={p.id}
                title={available ? undefined : info?.reason}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  !available
                    ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                    : selectedProviderIds.has(p.id)
                      ? "cursor-pointer border-slate-900 bg-slate-50"
                      : "cursor-pointer border-slate-200"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedProviderIds.has(p.id)}
                  onChange={() => toggleProvider(p.id)}
                  disabled={!available}
                />
                <span className="flex flex-col">
                  {p.name}
                  {!available && <span className="text-[10px] text-slate-400">{info?.reason}</span>}
                </span>
              </label>
            );
          })}
          {providers.length === 0 && <p className="text-sm text-slate-500">No active providers configured.</p>}
        </div>
      </Section>

      <Section title="Repetitions">
        <input
          type="number"
          min={1}
          max={20}
          value={repetitions}
          onChange={(e) => setRepetitions(Number(e.target.value))}
          className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">
          Repeating the same query helps measure variation in retrieval and model responses.
        </p>
      </Section>

      <div className="border-t border-slate-200 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Experiment summary</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
          <ReviewRow label="Politician" value={subjectName.trim() || "(not set)"} />
          <ReviewRow
            label="Mode"
            value={mode === "TARGETED_RETRIEVAL" ? "Targeted retrieval" : "Open-ended discovery"}
          />
          <ReviewRow label="Facts monitored" value={String(nonEmptyFacts.length)} />
          <ReviewRow label="Prompt" value={promptText.trim() ? `"${promptText.trim()}"` : "(not set)"} />
          <ReviewRow
            label="Models"
            value={providers.filter((p) => selectedProviderIds.has(p.id)).map((p) => p.name).join(", ") || "(none)"}
          />
          <ReviewRow label="Repetitions" value={String(repetitions)} />
          <ReviewRow label="Expected API calls" value={String(expectedCalls)} />
        </dl>

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="mt-6 w-full rounded-md bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? "Running…" : "Run experiment"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </div>
  );
}

function ModeCard({
  title,
  description,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-lg border p-4 text-left text-sm ${
        selected ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
      }`}
    >
      <span className="flex items-center justify-between font-semibold text-slate-900">
        {title}
        {selected && (
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
            Selected
          </span>
        )}
      </span>
      <span className="text-slate-600">{description}</span>
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="max-w-[65%] truncate text-right font-medium text-slate-900" title={value}>
        {value}
      </dd>
    </div>
  );
}
