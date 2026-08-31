// Real AI Video Demonstration, Stage 1 -- fail-closed configuration
// resolver. Mirrors photo-preview-provider-config.ts's own tri-state
// (disabled | invalid | enabled) shape exactly: unset VIDEO_DEMONSTRATION_PROVIDER
// means "disabled" (safe default -- task §8/§7 of this stage's own task:
// never hardcode a model, never make a paid call unauthorized). Model is
// always operator-configured, never hardcoded in business logic -- if the
// configured model turns out not to be a real accepted Veo model id, that
// surfaces as a real provider error at call time, never silently guessed
// or substituted here.

export type VideoDemonstrationProviderName = "google";

const ALLOWED_PROVIDERS: readonly VideoDemonstrationProviderName[] = ["google"];

// Verified Stage 2, section 1: fetched live against the CURRENT official
// Gemini API docs (ai.google.dev/gemini-api/docs/models and
// .../docs/pricing, both re-fetched this stage) -- these are the exact
// three real, current, billable Veo model id strings, each confirmed
// present on BOTH the models catalog page and the pricing page (which
// separately confirms per-second USD pricing for each). All three are
// status Preview (not GA) as of this verification.
//
// Stage 1's own allowlist additionally carried "veo-3-generate" and
// "veo-2-generate" as unverified placeholders from the earlier Stage 0
// research pass -- NEITHER appears on the current models page, the
// current pricing page, nor anywhere else in official docs fetched this
// stage. Removed: an allowlist containing an unconfirmed id defeats its
// own purpose (task §11 of the Decision Lock: never accept an arbitrary
// caller-supplied model string -- "arbitrary" includes one this codebase
// itself never actually verified). If Google ships a real Veo 2 or plain
// Veo 3 id later, add it here only once independently re-verified the
// same way, never by inference from a naming pattern.
//
// This resolves Stage 1's own documented "known gap": the installed SDK's
// doc-comment example uses the older `veo-2.0-generate-001` naming style,
// which is confirmed here to be a stale example, not evidence against
// veo-3.1-lite-generate-preview -- the current, real, and (per
// video-generation-provider-config.ts's own resolveVideoDemonstrationProviderConfig)
// still fully operator-configurable default.
//
// Kept as an allowlist for the same reason Photo Preview's own model
// allowlist exists -- the server-configured default
// (VIDEO_DEMONSTRATION_MODEL) is what actually picks the model; this list
// only bounds what a caller may request.
export const VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
] as const;
export type VideoDemonstrationVeoModel = (typeof VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS)[number];

export function isVideoDemonstrationVeoModel(value: unknown): value is VideoDemonstrationVeoModel {
  return typeof value === "string" && (VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS as readonly string[]).includes(value);
}

export function isVideoDemonstrationProviderName(value: unknown): value is VideoDemonstrationProviderName {
  return typeof value === "string" && (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

export type VideoDemonstrationProviderConfigIssueCode =
  | "VIDEO_DEMONSTRATION_PROVIDER_INVALID"
  | "VIDEO_DEMONSTRATION_API_KEY_REQUIRED"
  | "VIDEO_DEMONSTRATION_MODEL_REQUIRED"
  | "VIDEO_DEMONSTRATION_MODEL_INVALID";

export interface VideoDemonstrationProviderConfigIssue {
  code: VideoDemonstrationProviderConfigIssueCode;
  variable: string;
  message: string;
}

export interface VeoVideoDemonstrationProviderConfig {
  status: "enabled";
  provider: "google";
  apiKey: string;
  model: VideoDemonstrationVeoModel;
  // Operator dial, never hardcoded -- see photo-preview-provider-gemini.ts's
  // own PHOTO_PREVIEW_TIMEOUT_MS precedent (Stage 5 hardening) for why this
  // is wired through from the start here rather than retrofitted later.
  timeoutMs: number | undefined;
}

export type VideoDemonstrationProviderConfigResult =
  | { status: "disabled" }
  | { status: "invalid"; issues: VideoDemonstrationProviderConfigIssue[] }
  | VeoVideoDemonstrationProviderConfig;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function resolveVideoDemonstrationProviderConfig(env: EnvironmentSource): VideoDemonstrationProviderConfigResult {
  const provider = value(env.VIDEO_DEMONSTRATION_PROVIDER);

  if (!provider) {
    return { status: "disabled" };
  }

  if (!isAllowedProvider(provider)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "VIDEO_DEMONSTRATION_PROVIDER_INVALID",
          "VIDEO_DEMONSTRATION_PROVIDER",
          `VIDEO_DEMONSTRATION_PROVIDER must be one of: ${ALLOWED_PROVIDERS.join(", ")}.`,
        ),
      ],
    };
  }

  const issues: VideoDemonstrationProviderConfigIssue[] = [];
  const apiKey = value(env.VIDEO_DEMONSTRATION_API_KEY);
  const model = value(env.VIDEO_DEMONSTRATION_MODEL);

  if (!apiKey) {
    issues.push(
      issue(
        "VIDEO_DEMONSTRATION_API_KEY_REQUIRED",
        "VIDEO_DEMONSTRATION_API_KEY",
        "VIDEO_DEMONSTRATION_API_KEY is required when VIDEO_DEMONSTRATION_PROVIDER is set.",
      ),
    );
  }
  if (!model) {
    issues.push(
      issue(
        "VIDEO_DEMONSTRATION_MODEL_REQUIRED",
        "VIDEO_DEMONSTRATION_MODEL",
        "VIDEO_DEMONSTRATION_MODEL is required when VIDEO_DEMONSTRATION_PROVIDER is set.",
      ),
    );
  } else if (!isVideoDemonstrationVeoModel(model)) {
    issues.push(
      issue(
        "VIDEO_DEMONSTRATION_MODEL_INVALID",
        "VIDEO_DEMONSTRATION_MODEL",
        `VIDEO_DEMONSTRATION_MODEL must be one of: ${VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS.join(", ")}.`,
      ),
    );
  }

  if (issues.length > 0) {
    return { status: "invalid", issues };
  }

  return {
    status: "enabled",
    provider: "google",
    apiKey,
    model: model as VideoDemonstrationVeoModel,
    timeoutMs: parseTimeoutMs(env.VIDEO_DEMONSTRATION_TIMEOUT_MS),
  };
}

function isAllowedProvider(value: string): value is VideoDemonstrationProviderName {
  return (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

function parseTimeoutMs(raw: string | undefined): number | undefined {
  const trimmed = value(raw);
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function value(raw: string | undefined): string {
  return String(raw ?? "").trim();
}

function issue(code: VideoDemonstrationProviderConfigIssueCode, variable: string, message: string): VideoDemonstrationProviderConfigIssue {
  return { code, variable, message };
}
