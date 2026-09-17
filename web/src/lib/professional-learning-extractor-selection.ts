import { mockProfessionalLearningExtractor } from "@/lib/professional-learning-mock-extractor";
import { GeminiProfessionalLearningExtractor, type ProfessionalLearningExtractorError } from "@/lib/professional-learning-extractor-gemini";
import { resolveRealProfessionalLearningExtractionConfig } from "@/lib/professional-learning-real-extraction-config";
import type { ProfessionalLearningExtractor } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.1 -- PROVIDER
// SELECTION for the live Teach-the-AI draft-creation path. This is the
// ONE place the production route decides which ProfessionalLearningExtractor
// implementation to use -- neither the mock extractor
// (professional-learning-mock-extractor.ts) nor the real Gemini adapter
// (professional-learning-extractor-gemini.ts, already fully implemented,
// unmodified here) is duplicated or rewritten; this file only WIRES the
// existing, already-proven `resolveRealProfessionalLearningExtractionConfig`
// gate (Stage 8.5L4.R1, unchanged) to the existing extractor classes.
//
// FAIL-CLOSED, NEVER A SILENT FALLBACK (this stage's own explicit rule):
// three distinct config outcomes, three distinct behaviors --
//   "disabled"  -> mock extractor. This is the INTENTIONAL default (dev/
//                  test/CI, and any environment where the flag was never
//                  turned on) -- never an error.
//   "enabled"   -> the real GeminiProfessionalLearningExtractor.
//   "invalid"   -> the flag explicitly requested real extraction but the
//                  underlying AI_ANALYSIS_* configuration is broken.
//                  Throws ProfessionalLearningExtractorSelectionError
//                  rather than silently falling back to the mock -- a
//                  silent fallback here would make real extraction LOOK
//                  like it ran (a normal "insufficient evidence"-shaped
//                  mock response) while actually hiding a real
//                  configuration defect. The caller must surface this as
//                  a real, visible failure.
//
// PROVIDER-ERROR CLASSIFICATION: professional-learning-extractor-gemini.ts
// already throws a well-shaped ProfessionalLearningExtractorError (code:
// TIMEOUT|RATE_LIMITED|INVALID_RESPONSE|PROVIDER_ERROR|NOT_CONFIGURED) for
// every real-provider failure mode -- that file's own `isProviderError`
// helper is private (module-internal), so this file reproduces the exact
// same narrow, structural check (an Error with a `code` in this closed
// set) rather than exporting a new surface from that existing, stable,
// 900+-line file for one reuse. A caller (the route) uses
// isProfessionalLearningExtractorProviderError + the status-mapping
// helper below to fail honestly -- never a fabricated successful draft,
// never a disguised "insufficient evidence" response.
//
// NO SECRETS: every message surfaced here (config.reason from the
// resolver, or error.message from the real adapter) is already a plain,
// structural description ("AI_ANALYSIS_PROVIDER is not configured",
// "Gemini authentication failed.") -- never the API key itself. Verified
// directly against both source files; nothing new is introduced here
// that could leak one.

export class ProfessionalLearningExtractorSelectionError extends Error {
  readonly code = "REAL_EXTRACTION_MISCONFIGURED";
  readonly httpStatus = 503;

  constructor(reason: string) {
    super(`Real professional-learning extraction is enabled but misconfigured: ${reason}`);
    this.name = "ProfessionalLearningExtractorSelectionError";
  }
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function selectProfessionalLearningExtractor(env: EnvironmentSource): ProfessionalLearningExtractor {
  const config = resolveRealProfessionalLearningExtractionConfig(env);

  if (config.status === "enabled") {
    return new GeminiProfessionalLearningExtractor({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs });
  }
  if (config.status === "invalid") {
    throw new ProfessionalLearningExtractorSelectionError(config.reason);
  }
  return mockProfessionalLearningExtractor;
}

const PROFESSIONAL_LEARNING_EXTRACTOR_PROVIDER_ERROR_CODES = new Set(["TIMEOUT", "RATE_LIMITED", "INVALID_RESPONSE", "PROVIDER_ERROR", "NOT_CONFIGURED"]);

export function isProfessionalLearningExtractorProviderError(error: unknown): error is ProfessionalLearningExtractorError {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && PROFESSIONAL_LEARNING_EXTRACTOR_PROVIDER_ERROR_CODES.has(code);
}

export function professionalLearningExtractorProviderErrorHttpStatus(error: ProfessionalLearningExtractorError): number {
  switch (error.code) {
    case "TIMEOUT":
      return 504;
    case "RATE_LIMITED":
      return 429;
    case "NOT_CONFIGURED":
      return 503;
    case "INVALID_RESPONSE":
    case "PROVIDER_ERROR":
    default:
      return 502;
  }
}
