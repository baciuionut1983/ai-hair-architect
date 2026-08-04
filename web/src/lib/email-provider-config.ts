export type EmailProcessingMode = "disabled" | "enabled";

export type EmailConfigIssueCode =
  | "RESEND_API_KEY_REQUIRED"
  | "EMAIL_FROM_ADDRESS_REQUIRED";

export interface EmailConfigIssue {
  code: EmailConfigIssueCode;
  variable: string;
  message: string;
}

export interface EmailEnabledConfig {
  status: "enabled";
  apiKey: string;
  fromAddress: string;
  timeoutMs: number;
}

export type EmailConfigResult =
  | { status: "disabled" }
  | { status: "invalid"; issues: EmailConfigIssue[] }
  | EmailEnabledConfig;

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 500;

/**
 * Fail-closed email configuration. Sending is only ever "enabled" when
 * EMAIL_PROCESSING_MODE is explicitly "enabled" -- any other value
 * (missing, typo, anything else) resolves to "disabled", never a partial
 * or best-effort attempt. When enabled, a missing RESEND_API_KEY or
 * EMAIL_FROM_ADDRESS fails closed to "invalid" rather than sending from an
 * unconfigured address or with no credential.
 */
export function resolveEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfigResult {
  const mode = resolveEmailProcessingMode(env);
  if (mode !== "enabled") {
    return { status: "disabled" };
  }

  const issues: EmailConfigIssue[] = [];

  const apiKey = value(env.RESEND_API_KEY);
  if (!apiKey) {
    issues.push(
      issue("RESEND_API_KEY_REQUIRED", "RESEND_API_KEY", "RESEND_API_KEY is required when EMAIL_PROCESSING_MODE is enabled."),
    );
  }

  const fromAddress = value(env.EMAIL_FROM_ADDRESS);
  if (!fromAddress) {
    issues.push(
      issue("EMAIL_FROM_ADDRESS_REQUIRED", "EMAIL_FROM_ADDRESS", "EMAIL_FROM_ADDRESS is required when EMAIL_PROCESSING_MODE is enabled."),
    );
  }

  if (issues.length > 0) {
    return { status: "invalid", issues };
  }

  return {
    status: "enabled",
    apiKey,
    fromAddress,
    timeoutMs: resolveTimeoutMs(env.EMAIL_PROVIDER_TIMEOUT_MS),
  };
}

function resolveEmailProcessingMode(env: NodeJS.ProcessEnv): EmailProcessingMode {
  return env.EMAIL_PROCESSING_MODE === "enabled" ? "enabled" : "disabled";
}

function resolveTimeoutMs(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < MIN_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

function value(raw: string | undefined): string {
  return String(raw ?? "").trim();
}

function issue(code: EmailConfigIssueCode, variable: string, message: string): EmailConfigIssue {
  return { code, variable, message };
}
