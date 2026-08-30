// Real AI Photo Preview, Stage 1 -- fail-closed configuration resolver.
// Mirrors image-analysis-provider-config.ts's own tri-state
// (disabled | invalid | enabled) shape exactly, for the same reason: unset
// PHOTO_PREVIEW_PROVIDER means "disabled" (no real provider configured,
// the safe default for a feature Stage 1 explicitly forbids making paid
// calls with); any other unrecognized value is a misconfiguration, never
// silently coerced to disabled or to a default model.
//
// AI Photo Preview Stage 0/1 clarification: the exact Gemini model is NOT
// permanently locked. Two candidates are supported now
// (gemini-3.1-flash-image, gemini-3-pro-image); the production default is
// picked by explicit configuration, never hardcoded in domain code, and a
// caller can never supply an arbitrary model id of its own (task §11) --
// only one of this fixed allowlist is ever accepted.

export type PhotoPreviewProviderName = "gemini";

const ALLOWED_PROVIDERS: readonly PhotoPreviewProviderName[] = ["gemini"];

// The only two candidate models for the controlled A/B evaluation Stage 0
// recommended (task §30/§37) -- not a permanent lock. Adding a third
// candidate later is a one-line change here, never a domain-code change,
// since every domain/repository function only ever sees a validated
// `model: string` it already trusts.
export const PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS = ["gemini-3.1-flash-image", "gemini-3-pro-image"] as const;
export type PhotoPreviewGeminiModel = (typeof PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS)[number];

export function isPhotoPreviewGeminiModel(value: unknown): value is PhotoPreviewGeminiModel {
  return typeof value === "string" && (PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS as readonly string[]).includes(value);
}

// Exported (unlike the private isAllowedProvider() below it, which only
// exists to validate the PHOTO_PREVIEW_PROVIDER env var shape) so the
// generation repository can validate a caller-supplied provider string
// against the exact same allowlist, without a second competing copy of it.
export function isPhotoPreviewProviderName(value: unknown): value is PhotoPreviewProviderName {
  return typeof value === "string" && (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

export type PhotoPreviewProviderConfigIssueCode =
  | "PHOTO_PREVIEW_PROVIDER_INVALID"
  | "PHOTO_PREVIEW_API_KEY_REQUIRED"
  | "PHOTO_PREVIEW_MODEL_REQUIRED"
  | "PHOTO_PREVIEW_MODEL_INVALID";

export interface PhotoPreviewProviderConfigIssue {
  code: PhotoPreviewProviderConfigIssueCode;
  variable: string;
  message: string;
}

export interface GeminiPhotoPreviewProviderConfig {
  status: "enabled";
  provider: "gemini";
  apiKey: string;
  model: PhotoPreviewGeminiModel;
  // Stage 5 hardening (task §14) -- an operator dial on the real Gemini
  // provider timeout (GEMINI_PHOTO_PREVIEW_DEFAULT_TIMEOUT_MS's own doc
  // comment already promised this override; it was never actually wired
  // through until now). Undefined (unset, or not a positive finite number)
  // means "use the provider's own documented default" -- an invalid value
  // here is deliberately never treated as a config error: a malformed
  // tuning knob must never block the whole feature the way a missing API
  // key correctly does.
  timeoutMs: number | undefined;
}

export type PhotoPreviewProviderConfigResult =
  | { status: "disabled" }
  | { status: "invalid"; issues: PhotoPreviewProviderConfigIssue[] }
  | GeminiPhotoPreviewProviderConfig;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function resolvePhotoPreviewProviderConfig(env: EnvironmentSource): PhotoPreviewProviderConfigResult {
  const provider = value(env.PHOTO_PREVIEW_PROVIDER);

  if (!provider) {
    return { status: "disabled" };
  }

  if (!isAllowedProvider(provider)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "PHOTO_PREVIEW_PROVIDER_INVALID",
          "PHOTO_PREVIEW_PROVIDER",
          `PHOTO_PREVIEW_PROVIDER must be one of: ${ALLOWED_PROVIDERS.join(", ")}.`,
        ),
      ],
    };
  }

  const issues: PhotoPreviewProviderConfigIssue[] = [];
  const apiKey = value(env.PHOTO_PREVIEW_API_KEY);
  const model = value(env.PHOTO_PREVIEW_MODEL);

  if (!apiKey) {
    issues.push(
      issue("PHOTO_PREVIEW_API_KEY_REQUIRED", "PHOTO_PREVIEW_API_KEY", "PHOTO_PREVIEW_API_KEY is required when PHOTO_PREVIEW_PROVIDER is set."),
    );
  }
  if (!model) {
    issues.push(
      issue("PHOTO_PREVIEW_MODEL_REQUIRED", "PHOTO_PREVIEW_MODEL", "PHOTO_PREVIEW_MODEL is required when PHOTO_PREVIEW_PROVIDER is set."),
    );
  } else if (!isPhotoPreviewGeminiModel(model)) {
    issues.push(
      issue(
        "PHOTO_PREVIEW_MODEL_INVALID",
        "PHOTO_PREVIEW_MODEL",
        `PHOTO_PREVIEW_MODEL must be one of: ${PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS.join(", ")}.`,
      ),
    );
  }

  if (issues.length > 0) {
    return { status: "invalid", issues };
  }

  return { status: "enabled", provider: "gemini", apiKey, model: model as PhotoPreviewGeminiModel, timeoutMs: parseTimeoutMs(env.PHOTO_PREVIEW_TIMEOUT_MS) };
}

function parseTimeoutMs(raw: string | undefined): number | undefined {
  const trimmed = value(raw);
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isAllowedProvider(value: string): value is PhotoPreviewProviderName {
  return (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

function value(raw: string | undefined): string {
  return String(raw ?? "").trim();
}

function issue(code: PhotoPreviewProviderConfigIssueCode, variable: string, message: string): PhotoPreviewProviderConfigIssue {
  return { code, variable, message };
}
