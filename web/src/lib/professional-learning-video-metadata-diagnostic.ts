// AI Hair Architect, Professional Skill Engine Stage 8.5T1.3.R2 --
// TEMPORARY, REMOVABLE diagnostic observability for Gemini's own
// OUTPUT-ONLY File.videoMetadata. Pure, no I/O, no database, ZERO real
// AI calls.
//
// WHY THIS FILE EXISTS: T1.3.R1's real acceptance audit proved the
// released duration parser (parseGeminiFileVideoDurationSeconds in
// professional-learning-extractor-gemini.ts) reads a field name/shape
// that is NOT confirmed anywhere in the installed @google/genai SDK's
// own types -- videoMetadata is declared as an untyped
// `Record<string, unknown>`. This file OBSERVES the real shape once,
// safely, so the actual field can be identified from evidence instead
// of a second guess. It does NOT change the parser, persistence, or
// validator in any way (see that file's own, completely untouched
// parseGeminiFileVideoDurationSeconds).
//
// PRIVACY / SECURITY -- STRICT: this module NEVER emits a raw value.
// It emits ONLY: whether videoMetadata is present, its own top-level
// key names, each key's primitive TYPE, and -- for at most ONE
// candidate duration-like key -- a normalized primitive value, and
// ONLY when that key's name does not also look like an
// identifier/secret/location AND its value does not itself look like
// a URI/path/overlong string. A nested object or array's type is
// reported (e.g. "object"/"array"); its contents are never inspected,
// walked, or emitted -- this is a deliberate, one-level-only design
// (never recurses into a nested object's own keys), matching this
// stage's own "observe first, fix second" scope.
//
// ISOLATED AND REMOVABLE: this is the ONLY file this diagnostic lives
// in. Deleting this file plus its one call site in
// professional-learning-extractor-gemini.ts fully removes the
// instrumentation.

export interface ProfessionalLearningVideoMetadataDiagnosticCandidate {
  readonly field: string;
  readonly type: "string" | "number";
  readonly value: string | number;
}

export interface ProfessionalLearningVideoMetadataDiagnostic {
  readonly present: boolean;
  readonly keys: readonly string[];
  readonly types: Readonly<Record<string, string>>;
  readonly candidateDuration: ProfessionalLearningVideoMetadataDiagnosticCandidate | null;
}

// Conservative name matching (Section "DURATION-LIKE FIELD DETECTION")
// -- diagnostic purposes only, never used as production duration
// authority (that remains parseGeminiFileVideoDurationSeconds, wholly
// unmodified by this stage).
const DURATION_LIKE_NAME_PATTERN = /duration|length|seconds|time/i;

// Blocks a key from ever being treated as a candidate -- and therefore
// blocks its VALUE from ever being emitted -- regardless of whether its
// name also happens to match the duration-like pattern above (e.g. a
// hypothetical "durationUri"/"timeToken" would be blocked here first).
const SENSITIVE_NAME_PATTERN = /uri|url|path|file|key|token|secret|auth|credential|password|bucket|signature|etag|hash|name/i;

// A real Gemini Duration-string candidate ("67.601s") is always short.
// Anything longer than this is treated as NOT safe to emit as a value,
// independent of its key name -- a second, value-shape-based guard on
// top of the name-based one above.
const MAX_SAFE_CANDIDATE_STRING_LENGTH = 24;

function looksLikeUnsafeStringValue(value: string): boolean {
  if (value.length === 0 || value.length > MAX_SAFE_CANDIDATE_STRING_LENGTH) return true;
  if (value.includes("://")) return true;
  if (value.includes("/")) return true;
  return false;
}

function primitiveTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Builds the safe diagnostic structure described above. `videoMetadata`
// is the EXACT, untouched runtime value the installed @google/genai
// client returns as `File.videoMetadata` -- untrusted, unshaped input,
// exactly like every other provider-boundary parser in this codebase.
export function buildProfessionalLearningVideoMetadataDiagnostic(videoMetadata: unknown): ProfessionalLearningVideoMetadataDiagnostic {
  if (typeof videoMetadata !== "object" || videoMetadata === null) {
    return { present: false, keys: [], types: {}, candidateDuration: null };
  }

  const record = videoMetadata as Record<string, unknown>;
  const keys = Object.keys(record);
  const types: Record<string, string> = {};
  let candidateDuration: ProfessionalLearningVideoMetadataDiagnosticCandidate | null = null;

  for (const key of keys) {
    const value = record[key];
    types[key] = primitiveTypeName(value);

    // At most one candidate is ever reported -- first structural match
    // wins, deterministically. Never overwritten once set.
    if (candidateDuration) continue;
    if (!DURATION_LIKE_NAME_PATTERN.test(key)) continue;
    if (SENSITIVE_NAME_PATTERN.test(key)) continue;

    if (typeof value === "string") {
      if (looksLikeUnsafeStringValue(value)) continue;
      candidateDuration = { field: key, type: "string", value };
    } else if (typeof value === "number" && Number.isFinite(value)) {
      candidateDuration = { field: key, type: "number", value };
    }
  }

  return { present: true, keys, types, candidateDuration };
}
