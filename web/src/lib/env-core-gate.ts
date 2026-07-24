export type CoreGatePhase = "build" | "runtime";
export type CoreGateMode = "production" | "development" | "test" | "unknown";

export interface EnvVariableMatrix {
  requiredInProduction: string[];
  optionalInProduction: string[];
  developmentTestOnly: string[];
}

export interface EnvValidationIssue {
  code:
    | "ENV_NODE_ENV_INVALID"
    | "ENV_DATABASE_URL_REQUIRED"
    | "ENV_WEBHOOK_KEY_REQUIRED"
    | "ENV_WEBHOOK_KEY_INVALID"
    | "ENV_AUTH_BCRYPT_COST_INVALID";
  variable?: string;
  message: string;
}

export interface EnvValidationResult {
  phase: CoreGatePhase;
  mode: CoreGateMode;
  ok: boolean;
  issues: EnvValidationIssue[];
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const WEBHOOK_KEY_EXPECTED_BYTES = 32;

export const ENV_CORE_GATE_MATRIX: EnvVariableMatrix = {
  requiredInProduction: ["NODE_ENV", "DATABASE_URL", "WEBHOOK_SECRET_ENCRYPTION_KEY"],
  optionalInProduction: [
    "AUTH_BCRYPT_COST",
    "AI_EXPLAINER_ENDPOINT",
    "AI_EXPLAINER_API_KEY",
    "AI_EXPLAINER_TIMEOUT_MS"
  ],
  developmentTestOnly: ["TEST_DATABASE_URL"]
};

export function classifyEnvVariables(): EnvVariableMatrix {
  return {
    requiredInProduction: [...ENV_CORE_GATE_MATRIX.requiredInProduction],
    optionalInProduction: [...ENV_CORE_GATE_MATRIX.optionalInProduction],
    developmentTestOnly: [...ENV_CORE_GATE_MATRIX.developmentTestOnly]
  };
}

export function detectCoreGateMode(env: NodeJS.ProcessEnv): CoreGateMode {
  const value = String(env.NODE_ENV ?? "").trim();
  if (value === "production") {
    return "production";
  }
  if (value === "development") {
    return "development";
  }
  if (value === "test") {
    return "test";
  }
  return "unknown";
}

export function validateBuildTimeEnvironment(env: NodeJS.ProcessEnv): EnvValidationResult {
  const issues: EnvValidationIssue[] = [];
  const mode = detectCoreGateMode(env);
  const rawNodeEnv = String(env.NODE_ENV ?? "").trim();

  if (rawNodeEnv.length > 0 && mode === "unknown") {
    issues.push({
      code: "ENV_NODE_ENV_INVALID",
      variable: "NODE_ENV",
      message: "NODE_ENV must be one of production, development, or test when provided."
    });
  }

  const bcryptCost = env.AUTH_BCRYPT_COST;
  if (typeof bcryptCost === "string" && bcryptCost.trim().length > 0) {
    const parsed = Number(bcryptCost);
    if (!Number.isInteger(parsed) || parsed < 4 || parsed > 16) {
      issues.push({
        code: "ENV_AUTH_BCRYPT_COST_INVALID",
        variable: "AUTH_BCRYPT_COST",
        message: "AUTH_BCRYPT_COST must be an integer between 4 and 16."
      });
    }
  }

  const webhookKey = env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (typeof webhookKey === "string" && webhookKey.trim().length > 0) {
    const keyIssue = validateWebhookSecretEncryptionKey(webhookKey);
    if (keyIssue) {
      issues.push(keyIssue);
    }
  }

  return {
    phase: "build",
    mode,
    ok: issues.length === 0,
    issues
  };
}

export function validateRuntimeProductionEnvironment(env: NodeJS.ProcessEnv): EnvValidationResult {
  const issues: EnvValidationIssue[] = [];
  const mode = detectCoreGateMode(env);

  if (mode !== "production") {
    return {
      phase: "runtime",
      mode,
      ok: true,
      issues: []
    };
  }

  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    issues.push({
      code: "ENV_DATABASE_URL_REQUIRED",
      variable: "DATABASE_URL",
      message: "DATABASE_URL is required for production runtime."
    });
  }

  const webhookKey = String(env.WEBHOOK_SECRET_ENCRYPTION_KEY ?? "").trim();
  if (!webhookKey) {
    issues.push({
      code: "ENV_WEBHOOK_KEY_REQUIRED",
      variable: "WEBHOOK_SECRET_ENCRYPTION_KEY",
      message: "WEBHOOK_SECRET_ENCRYPTION_KEY is required for production runtime."
    });
  } else {
    const keyIssue = validateWebhookSecretEncryptionKey(webhookKey);
    if (keyIssue) {
      issues.push(keyIssue);
    }
  }

  const bcryptCost = env.AUTH_BCRYPT_COST;
  if (typeof bcryptCost === "string" && bcryptCost.trim().length > 0) {
    const parsed = Number(bcryptCost);
    if (!Number.isInteger(parsed) || parsed < 4 || parsed > 16) {
      issues.push({
        code: "ENV_AUTH_BCRYPT_COST_INVALID",
        variable: "AUTH_BCRYPT_COST",
        message: "AUTH_BCRYPT_COST must be an integer between 4 and 16."
      });
    }
  }

  return {
    phase: "runtime",
    mode,
    ok: issues.length === 0,
    issues
  };
}

export function formatValidationIssues(issues: EnvValidationIssue[]): string {
  return issues.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n");
}

function validateWebhookSecretEncryptionKey(rawValue: string): EnvValidationIssue | null {
  const normalized = rawValue.trim();
  if (!BASE64_PATTERN.test(normalized)) {
    return {
      code: "ENV_WEBHOOK_KEY_INVALID",
      variable: "WEBHOOK_SECRET_ENCRYPTION_KEY",
      message: "WEBHOOK_SECRET_ENCRYPTION_KEY must be valid Base64 text."
    };
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length !== WEBHOOK_KEY_EXPECTED_BYTES) {
    return {
      code: "ENV_WEBHOOK_KEY_INVALID",
      variable: "WEBHOOK_SECRET_ENCRYPTION_KEY",
      message: "WEBHOOK_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes."
    };
  }

  return null;
}
