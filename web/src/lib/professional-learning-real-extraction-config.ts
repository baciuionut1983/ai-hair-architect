import { resolveImageAnalysisProviderConfig } from "@/lib/image-analysis-provider-config";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R1 -- SAFE
// DEFAULT / FEATURE FLAG (Part 39). Real professional-learning extraction
// must NOT run automatically for every Teach-the-AI upload -- the
// existing POST /api/v1/learning-evidence/[evidenceId]/drafts route
// (unchanged by this stage) still hardcodes the mock extractor
// unconditionally, so uploading evidence can never unexpectedly spend AI
// money regardless of this resolver's result. This function exists as an
// explicit, additive, defense-in-depth gate for the one authorized manual
// acceptance script and any future, separately-reviewed call site: real
// extraction is available ONLY when BOTH (a) the existing, already-live
// AI_ANALYSIS_* Gemini configuration is valid (Part 4: reuse existing
// infrastructure, no new vendor/env family), AND (b)
// PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED is explicitly "true" --
// unset/anything else means disabled, fail-closed.

export type RealProfessionalLearningExtractionConfigResult =
  | { readonly status: "disabled" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "enabled"; readonly apiKey: string; readonly model: string; readonly timeoutMs: number };

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function resolveRealProfessionalLearningExtractionConfig(env: EnvironmentSource): RealProfessionalLearningExtractionConfigResult {
  if (String(env.PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED ?? "").trim().toLowerCase() !== "true") {
    return { status: "disabled" };
  }

  const analysisConfig = resolveImageAnalysisProviderConfig(env);
  if (analysisConfig.status === "disabled") {
    return { status: "invalid", reason: "PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED is true but AI_ANALYSIS_PROVIDER is not configured -- reusing that same, already-live Gemini configuration is required (Part 4)." };
  }
  if (analysisConfig.status === "invalid") {
    return { status: "invalid", reason: `AI_ANALYSIS_* configuration is invalid: ${analysisConfig.issues.map((i) => i.code).join(", ")}.` };
  }

  return { status: "enabled", apiKey: analysisConfig.apiKey, model: analysisConfig.model, timeoutMs: analysisConfig.timeoutMs };
}
