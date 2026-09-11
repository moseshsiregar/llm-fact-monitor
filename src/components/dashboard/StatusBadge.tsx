const STATUS_STYLES: Record<string, string> = {
  FOUND: "bg-emerald-50 text-emerald-700 border-emerald-200",
  NOT_FOUND: "bg-slate-50 text-slate-500 border-slate-200",
  UNCERTAIN: "bg-amber-50 text-amber-700 border-amber-200",
  // Phase 8 Section 11 - a technical verification error must be visually
  // DISTINCT from both ❌ (NOT_FOUND) and ⚠️ (UNCERTAIN); it means "we don't
  // know", not "checked and absent" or "checked and ambiguous".
  VERIFICATION_ERROR: "bg-orange-50 text-orange-700 border-orange-300 border-dashed",
};

const STATUS_ICON: Record<string, string> = {
  FOUND: "✅",
  NOT_FOUND: "❌",
  UNCERTAIN: "⚠️",
  VERIFICATION_ERROR: "❓",
};

const STATUS_LABEL: Record<string, string> = {
  FOUND: "Found",
  NOT_FOUND: "Not found",
  UNCERTAIN: "Uncertain",
  VERIFICATION_ERROR: "Verification error",
};

export function StatusBadge({
  status,
  domain,
  compact = false,
  /** Phase 8 - the raw 4-class semantic verdict, when available. Used only
   * to distinguish "Partial support" from "Genuinely uncertain" in the
   * tooltip/label - the icon/color stays the same as UNCERTAIN (both map to
   * ⚠️ per the shared icon table), preserving the methodologically useful
   * distinction without adding a new visual category to the matrix. */
  semanticStatus = null,
  /** Phase 8 Section 6/11 - true when this observation's semantic verifier
   * call technically failed (timeout/rate-limit/outage/etc). Takes
   * precedence over `status` for rendering - a technical failure must NEVER
   * be displayed as ❌ NOT_FOUND. */
  verificationError = false,
  /** Detector-versioning audit - false when `status`/`semanticStatus` come
   * from a historical/deterministic row that has not yet been reprocessed
   * with the current semantic-only production detector. Renders a small,
   * distinct footnote so this is never confused with a semantic result -
   * never changes the icon/color, only adds the disclosure text. */
  classifiedWithCurrentDetector = true,
}: {
  status: "FOUND" | "NOT_FOUND" | "UNCERTAIN";
  domain?: string | null;
  compact?: boolean;
  semanticStatus?: "FOUND" | "PARTIAL_SUPPORT" | "NOT_FOUND" | "UNCERTAIN" | null;
  verificationError?: boolean;
  classifiedWithCurrentDetector?: boolean;
}) {
  const displayKey = verificationError ? "VERIFICATION_ERROR" : status;
  const label =
    !verificationError && semanticStatus === "PARTIAL_SUPPORT" ? "Partial support" : STATUS_LABEL[displayKey];
  const title = classifiedWithCurrentDetector ? label : `${label} (not classified with current detector)`;

  return (
    <div
      className={`flex flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-center ${STATUS_STYLES[displayKey]}`}
      title={title}
    >
      <span className={compact ? "text-sm" : "text-base"}>{STATUS_ICON[displayKey]}</span>
      {verificationError ? (
        <span className="max-w-[9rem] truncate text-[11px] font-medium leading-tight">
          Verification error
        </span>
      ) : !classifiedWithCurrentDetector ? (
        <span className="max-w-[9rem] truncate text-[11px] font-medium leading-tight text-slate-400">
          Pending reclassification
        </span>
      ) : domain ? (
        <span className="max-w-[9rem] truncate text-[11px] font-medium leading-tight">
          {domain}
        </span>
      ) : (
        <span className="text-[11px] leading-tight text-slate-400">&mdash;</span>
      )}
    </div>
  );
}


