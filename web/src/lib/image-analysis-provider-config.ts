import { GEMINI_DEFAULT_TIMEOUT_MS } from "@/lib/image-analysis-provider-gemini";

export type ImageAnalysisProviderName = "gemini";

const ALLOWED_PROVIDERS: readonly ImageAnalysisProviderName[] = ["gemini"];

export type ImageAnalysisProviderConfigIssueCode =
  | "AI_ANALYSIS_PROVIDER_INVALID"
  | "AI_ANALYSIS_API_KEY_REQUIRED"
  | "AI_ANALYSIS_MODEL_REQUIRED";

export interface ImageAnalysisProviderConfigIssue {
  code: ImageAnalysisProviderConfigIssueCode;
  variable: string;
  message: string;
}

export interface GeminiImageAnalysisProviderConfig {
  status: "enabled";
  provider: "gemini";
  apiKey: string;
  model: string;
  timeoutMs: number;
}

// Bounds for the optional AI_ANALYSIS_TIMEOUT_MS override -- a misconfigured
// value (0, negative, non-numeric, or absurdly large) must never produce an
// unbounded or effectively-disabled timeout; it silently clamps to this
// range instead of flipping config status to "invalid", since an operator
// tuning this value should never accidentally take the whole provider down.
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 120_000;

export type ImageAnalysisProviderConfigResult =
  | { status: "disabled" }
  | { status: "invalid"; issues: ImageAnalysisProviderConfigIssue[] }
  | GeminiImageAnalysisProviderConfig;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Fail-closed configuration resolver for the real external AI provider.
 * Unset AI_ANALYSIS_PROVIDER means "disabled" (no real provider configured).
 * Any other unrecognized value is treated as a misconfiguration ("invalid"),
 * never silently coerced to "disabled" or to a default provider -- an
 * operator who mistyped the variable should see an explicit error, not a
 * silent no-op.
 */
export function resolveImageAnalysisProviderConfig(env: EnvironmentSource): ImageAnalysisProviderConfigResult {
  const provider = value(env.AI_ANALYSIS_PROVIDER);

  if (!provider) {
    return { status: "disabled" };
  }

  if (!isAllowedProvider(provider)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "AI_ANALYSIS_PROVIDER_INVALID",
          "AI_ANALYSIS_PROVIDER",
          `AI_ANALYSIS_PROVIDER must be one of: ${ALLOWED_PROVIDERS.join(", ")}.`,
        ),
      ],
    };
  }

  const issues: ImageAnalysisProviderConfigIssue[] = [];
  const apiKey = value(env.AI_ANALYSIS_API_KEY);
  const model = value(env.AI_ANALYSIS_MODEL);

  if (!apiKey) {
    issues.push(issue("AI_ANALYSIS_API_KEY_REQUIRED", "AI_ANALYSIS_API_KEY", "AI_ANALYSIS_API_KEY is required when AI_ANALYSIS_PROVIDER is set."));
  }
  if (!model) {
    issues.push(issue("AI_ANALYSIS_MODEL_REQUIRED", "AI_ANALYSIS_MODEL", "AI_ANALYSIS_MODEL is required when AI_ANALYSIS_PROVIDER is set."));
  }

  if (issues.length > 0) {
    return { status: "invalid", issues };
  }

  return { status: "enabled", provider: "gemini", apiKey, model, timeoutMs: resolveTimeoutMs(env.AI_ANALYSIS_TIMEOUT_MS) };
}

// Optional override, clamped rather than validated -- see MIN/MAX_TIMEOUT_MS.
// Unset, empty, non-numeric, or out-of-range values all fall back to the
// same realistic default the provider itself uses (GEMINI_DEFAULT_TIMEOUT_MS).
function resolveTimeoutMs(raw: string | undefined): number {
  const trimmed = value(raw);
  if (!trimmed) {
    return GEMINI_DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return GEMINI_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
}

function isAllowedProvider(value: string): value is ImageAnalysisProviderName {
  return (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

function value(raw: string | undefined): string {
  return String(raw ?? "").trim();
}

function issue(
  code: ImageAnalysisProviderConfigIssueCode,
  variable: string,
  message: string,
): ImageAnalysisProviderConfigIssue {
  return { code, variable, message };
}
