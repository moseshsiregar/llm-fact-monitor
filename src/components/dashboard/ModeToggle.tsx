"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ExperimentMode } from "@prisma/client";

const MODES: { value: ExperimentMode; label: string; description: string }[] = [
  {
    value: "TARGETED_RETRIEVAL",
    label: "Targeted retrieval",
    description: "Which monitored facts were retrieved when prompts directed the model toward their topic?",
  },
  {
    value: "OPEN_ENDED_DISCOVERY",
    label: "Open-ended discovery",
    description: "Which monitored facts surfaced spontaneously in general LLM responses?",
  },
];

export function ModeToggle({ activeMode }: { activeMode: ExperimentMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setMode(mode: ExperimentMode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", mode);
    router.push(`/?${params.toString()}`);
  }

  const active = MODES.find((m) => m.value === activeMode) ?? MODES[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-white p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              m.value === activeMode
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-600">{active.description}</p>
    </div>
  );
}
