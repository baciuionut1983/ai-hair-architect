import {
  validateRuntimeProductionEnvironment,
  type EnvValidationIssue,
} from "@/lib/env-core-gate";
import {
  getBusinessPersistenceReadinessDomains,
  type BusinessPersistenceReadinessDomain,
  type BusinessPersistenceRuntime,
} from "@/lib/business-persistence-guards";

export type ReadinessStatus = "READY" | "NOT_READY";
export type ReadinessCheckStatus = "PASS" | "FAIL";

export type ReadinessCheckCode =
  | "ENV_RUNTIME_VALID"
  | "BUSINESS_PERSISTENCE_PRODUCTION_READY"
  | "BILLING_WEBHOOK_AUTHENTICITY_READY"
  | "STORAGE_PRODUCTION_POLICY_READY";

export interface ReadinessCheck {
  code: ReadinessCheckCode;
  status: ReadinessCheckStatus;
  critical: true;
  message: string;
}

export interface ReadinessPayload {
  status: ReadinessStatus;
  checks: ReadinessCheck[];
  businessPersistenceDomains: BusinessPersistenceReadinessDomain[];
  requestId: string;
  timestamp: string;
}

export interface ReadinessEvaluation {
  httpStatus: 200 | 503;
  payload: ReadinessPayload;
}

export interface ProductionPolicyError {
  code: string;
  message: string;
  httpStatus: 503;
}

export const PRODUCTION_POLICY_ERROR_CODES = {
  BILLING_WEBHOOK_DISABLED: "PRODUCTION_POLICY_BILLING_WEBHOOK_DISABLED",
  STORAGE_LOCAL_BLOCKED: "PRODUCTION_POLICY_LOCAL_STORAGE_BLOCKED",
  PERSISTENCE_NOT_READY: "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_NOT_READY"
} as const;

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.NODE_ENV ?? "").trim() === "production";
}

export function getBillingWebhookProductionError(
  env: NodeJS.ProcessEnv = process.env
): ProductionPolicyError | null {
  if (!isProductionRuntime(env)) {
    return null;
  }

  return {
    code: PRODUCTION_POLICY_ERROR_CODES.BILLING_WEBHOOK_DISABLED,
    message:
      "Billing webhook is disabled in production until provider authenticity verification is implemented.",
    httpStatus: 503
  };
}

export function evaluateReadiness(input: {
  requestId: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): ReadinessEvaluation {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const envValidation = validateRuntimeProductionEnvironment(env);
  const businessPersistenceDomains = getBusinessPersistenceReadinessDomains(resolveReadinessRuntime(env));

  const checks: ReadinessCheck[] = [
    buildEnvCheck(envValidation.issues),
    {
      code: "BUSINESS_PERSISTENCE_PRODUCTION_READY",
      status: "FAIL",
      critical: true,
      message:
        "Business persistence remains in-memory for critical product domains and is not production-ready."
    },
    {
      code: "BILLING_WEBHOOK_AUTHENTICITY_READY",
      status: "FAIL",
      critical: true,
      message:
        "Billing webhook provider authenticity verification is not implemented."
    },
    {
      code: "STORAGE_PRODUCTION_POLICY_READY",
      status: "FAIL",
      critical: true,
      message:
        "Local filesystem storage is not an approved production backend."
    }
  ];

  const hasFailure = checks.some((check) => check.status === "FAIL");

  return {
    httpStatus: hasFailure ? 503 : 200,
    payload: {
      status: hasFailure ? "NOT_READY" : "READY",
      checks,
      businessPersistenceDomains,
      requestId: input.requestId,
      timestamp: now.toISOString()
    }
  };
}

function resolveReadinessRuntime(env: NodeJS.ProcessEnv): BusinessPersistenceRuntime {
  if (env.NODE_ENV === "production") {
    return "production";
  }

  if (env.NODE_ENV === "test") {
    return "test";
  }

  return "development";
}

function buildEnvCheck(issues: EnvValidationIssue[]): ReadinessCheck {
  if (issues.length === 0) {
    return {
      code: "ENV_RUNTIME_VALID",
      status: "PASS",
      critical: true,
      message: "Runtime environment policy checks passed for current mode."
    };
  }

  return {
    code: "ENV_RUNTIME_VALID",
    status: "FAIL",
    critical: true,
    message: `Runtime environment validation failed with ${issues.length} issue(s).`
  };
}
