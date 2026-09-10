import { resolveVideoDemonstrationProviderConfig } from "@/lib/video-generation-provider-config";

// AI Hair Architect, Stage 8.5A -- TECHNICAL RENDER PROVIDER CONFIG
// (Part X). Pure, deterministic, no I/O, no network. Resolves the
// configuration boundary for the NEW professional-brain technical render
// path (VisualInstructionPackage -> ProviderInstruction -> future Veo
// request), separately from the older Result-Video / Technical Demonstration
// video paths.
//
// ARCHITECTURAL DECISION (repository-convention based): OPTION B --
// share the credential, isolate the feature.
//   * The professional technical render path is OFF by default. It
//     requires an EXPLICIT opt-in: PROFESSIONAL_TECHNICAL_RENDER_ENABLED
//     must be exactly "true". It is NEVER inferred from
//     VIDEO_DEMONSTRATION_* being present -- enabling the old video
//     feature must not silently enable this one (Part X: "Do not weaken
//     feature isolation merely to make a test pass").
//   * The provider credential (a Google API key) is the SAME Google
//     account regardless of feature, so it is SHARED with
//     VIDEO_DEMONSTRATION_API_KEY via resolveVideoDemonstrationProviderConfig
//     -- there is no reason to copy a secret into a second variable
//     (Part X: "Do NOT copy secrets").
//   * The MODEL for this path is configured INDEPENDENTLY via
//     PROFESSIONAL_TECHNICAL_RENDER_MODEL, so the new feature's model
//     choice never rides on the old feature's dial. Set it to the literal
//     "inherit" to deliberately reuse VIDEO_DEMONSTRATION_MODEL.
//
// This module NEVER returns, logs, or exposes the API key value -- only
// `apiKeyPresent: boolean`.

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export type TechnicalRenderProviderConfigResult =
  | { status: "disabled"; reason: string }
  | { status: "invalid"; issues: readonly { variable: string; message: string }[] }
  | {
      status: "configured";
      provider: "google";
      model: string;
      apiKeyPresent: true;
      credentialSource: "SHARED_VIDEO_DEMONSTRATION";
      modelSource: "DEDICATED" | "INHERITED_VIDEO_DEMONSTRATION";
      timeoutMs: number | undefined;
    };

function value(raw: string | undefined): string {
  return (raw ?? "").trim();
}

export function resolveTechnicalRenderProviderConfig(env: EnvironmentSource): TechnicalRenderProviderConfigResult {
  if (value(env.PROFESSIONAL_TECHNICAL_RENDER_ENABLED) !== "true") {
    return { status: "disabled", reason: "PROFESSIONAL_TECHNICAL_RENDER_ENABLED is not \"true\" -- the professional technical render path is intentionally off." };
  }

  const shared = resolveVideoDemonstrationProviderConfig(env);
  if (shared.status === "disabled") {
    return { status: "invalid", issues: [{ variable: "VIDEO_DEMONSTRATION_PROVIDER", message: "The shared video provider is not configured; the professional render path needs its credential." }] };
  }
  if (shared.status === "invalid") {
    return { status: "invalid", issues: shared.issues.map((i) => ({ variable: i.variable, message: i.message })) };
  }

  const dedicatedModel = value(env.PROFESSIONAL_TECHNICAL_RENDER_MODEL);
  let model: string;
  let modelSource: "DEDICATED" | "INHERITED_VIDEO_DEMONSTRATION";
  if (!dedicatedModel) {
    return { status: "invalid", issues: [{ variable: "PROFESSIONAL_TECHNICAL_RENDER_MODEL", message: "PROFESSIONAL_TECHNICAL_RENDER_MODEL is required (set a model id, or \"inherit\" to reuse VIDEO_DEMONSTRATION_MODEL)." }] };
  }
  if (dedicatedModel === "inherit") {
    model = shared.model;
    modelSource = "INHERITED_VIDEO_DEMONSTRATION";
  } else {
    model = dedicatedModel;
    modelSource = "DEDICATED";
  }

  return {
    status: "configured",
    provider: "google",
    model,
    apiKeyPresent: true,
    credentialSource: "SHARED_VIDEO_DEMONSTRATION",
    modelSource,
    timeoutMs: shared.timeoutMs,
  };
}

// PRESENT/MISSING-only summary for a diagnostic surface. Never any value.
export interface TechnicalRenderProviderConfigSummary {
  enabled: boolean;
  status: TechnicalRenderProviderConfigResult["status"];
  provider: string | null;
  model: string | null;
  apiKeyPresent: boolean;
  modelPresent: boolean;
  issues: readonly string[];
}

export function summarizeTechnicalRenderProviderConfig(env: EnvironmentSource): TechnicalRenderProviderConfigSummary {
  const result = resolveTechnicalRenderProviderConfig(env);
  if (result.status === "configured") {
    return { enabled: true, status: "configured", provider: result.provider, model: result.model, apiKeyPresent: true, modelPresent: true, issues: [] };
  }
  if (result.status === "invalid") {
    return { enabled: value(env.PROFESSIONAL_TECHNICAL_RENDER_ENABLED) === "true", status: "invalid", provider: null, model: null, apiKeyPresent: false, modelPresent: false, issues: result.issues.map((i) => `${i.variable}: ${i.message}`) };
  }
  return { enabled: false, status: "disabled", provider: null, model: null, apiKeyPresent: false, modelPresent: false, issues: [result.reason] };
}
