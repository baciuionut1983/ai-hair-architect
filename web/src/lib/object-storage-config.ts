import { ObjectStorageError } from "./object-storage-errors";

export type ObjectStorageMode = "production" | "development" | "test" | "unknown";
export type ObjectStorageServerSideEncryption = "none" | "AES256" | "aws:kms";

export interface LocalObjectStorageConfig {
  backend: "local";
}

export interface S3ObjectStorageConfig {
  backend: "s3";
  bucketAlias: string;
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  serverSideEncryption: ObjectStorageServerSideEncryption;
  kmsKeyId?: string;
  prefix: string;
  requestTimeoutMs: number;
}

export type ObjectStorageConfig = LocalObjectStorageConfig | S3ObjectStorageConfig;

export type ObjectStorageConfigIssueCode =
  | "OBJECT_STORAGE_BACKEND_REQUIRED"
  | "OBJECT_STORAGE_BACKEND_INVALID"
  | "OBJECT_STORAGE_S3_VALUE_REQUIRED"
  | "OBJECT_STORAGE_BOOLEAN_INVALID"
  | "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_REQUIRED"
  | "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_INVALID"
  | "OBJECT_STORAGE_ENDPOINT_INVALID"
  | "OBJECT_STORAGE_PREFIX_INVALID"
  | "OBJECT_STORAGE_TIMEOUT_INVALID";

export interface ObjectStorageConfigIssue {
  code: ObjectStorageConfigIssueCode;
  variable: string;
  message: string;
}

export interface ObjectStorageConfigValidation {
  ok: boolean;
  config: ObjectStorageConfig | null;
  issues: ObjectStorageConfigIssue[];
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 30_000;
const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,127}$/;

export function validateObjectStorageConfig(
  env: EnvironmentSource,
  mode: ObjectStorageMode
): ObjectStorageConfigValidation {
  const backend = value(env.OBJECT_STORAGE_BACKEND);
  const issues: ObjectStorageConfigIssue[] = [];

  if (!backend) {
    if (mode === "production") {
      issues.push(issue("OBJECT_STORAGE_BACKEND_REQUIRED", "OBJECT_STORAGE_BACKEND", "OBJECT_STORAGE_BACKEND must be s3 in production."));
    }
    return result(null, issues);
  }

  if (backend === "local") {
    if (mode === "production") {
      issues.push(issue("OBJECT_STORAGE_BACKEND_INVALID", "OBJECT_STORAGE_BACKEND", "Production object storage requires the s3 backend."));
      return result(null, issues);
    }
    return result({ backend: "local" }, issues);
  }

  if (backend !== "s3") {
    issues.push(issue("OBJECT_STORAGE_BACKEND_INVALID", "OBJECT_STORAGE_BACKEND", "OBJECT_STORAGE_BACKEND must be local or s3."));
    return result(null, issues);
  }

  const bucketAlias = required(env, "OBJECT_STORAGE_BUCKET_ALIAS", issues);
  const bucket = required(env, "OBJECT_STORAGE_BUCKET", issues);
  const region = required(env, "OBJECT_STORAGE_REGION", issues);
  const endpoint = validateEndpoint(value(env.OBJECT_STORAGE_ENDPOINT), mode, issues);
  const forcePathStyle = validateBoolean(value(env.OBJECT_STORAGE_FORCE_PATH_STYLE), issues);
  const serverSideEncryption = validateServerSideEncryption(
    value(env.OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION),
    mode,
    issues
  );
  const prefix = value(env.OBJECT_STORAGE_PREFIX) || "v1";
  const requestTimeoutMs = validateTimeout(value(env.OBJECT_STORAGE_REQUEST_TIMEOUT_MS), issues);

  if (!PREFIX_PATTERN.test(prefix) || prefix.includes("..") || prefix.startsWith("/") || prefix.endsWith("/")) {
    issues.push(issue("OBJECT_STORAGE_PREFIX_INVALID", "OBJECT_STORAGE_PREFIX", "OBJECT_STORAGE_PREFIX must be a relative, traversal-free prefix."));
  }

  if (issues.length > 0 || !bucketAlias || !bucket || !region || !serverSideEncryption) {
    return result(null, issues);
  }

  return result({
    backend: "s3",
    bucketAlias,
    bucket,
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    serverSideEncryption,
    ...(value(env.OBJECT_STORAGE_KMS_KEY_ID) ? { kmsKeyId: value(env.OBJECT_STORAGE_KMS_KEY_ID) } : {}),
    prefix,
    requestTimeoutMs
  }, issues);
}

export function loadObjectStorageConfig(env: EnvironmentSource, mode: ObjectStorageMode): ObjectStorageConfig {
  const validation = validateObjectStorageConfig(env, mode);
  if (!validation.ok || !validation.config) {
    throw new ObjectStorageError("configuration");
  }
  return validation.config;
}

function required(env: EnvironmentSource, variable: string, issues: ObjectStorageConfigIssue[]): string {
  const configuredValue = value(env[variable]);
  if (!configuredValue) {
    issues.push(issue("OBJECT_STORAGE_S3_VALUE_REQUIRED", variable, `${variable} is required when the s3 backend is active.`));
  }
  return configuredValue;
}

function validateBoolean(raw: string, issues: ObjectStorageConfigIssue[]): boolean {
  if (!raw) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  issues.push(issue("OBJECT_STORAGE_BOOLEAN_INVALID", "OBJECT_STORAGE_FORCE_PATH_STYLE", "OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false."));
  return false;
}

function validateEndpoint(raw: string, mode: ObjectStorageMode, issues: ObjectStorageConfigIssue[]): string | undefined {
  if (!raw) return undefined;
  try {
    const endpoint = new URL(raw);
    const allowedProtocol = endpoint.protocol === "https:" || (mode !== "production" && endpoint.protocol === "http:");
    if (!allowedProtocol || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error("invalid endpoint");
    }
    return endpoint.toString().replace(/\/$/, "");
  } catch {
    issues.push(issue("OBJECT_STORAGE_ENDPOINT_INVALID", "OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_ENDPOINT must be an approved absolute URL without credentials or query data."));
    return undefined;
  }
}

function validateTimeout(raw: string, issues: ObjectStorageConfigIssue[]): number {
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const timeout = Number(raw);
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
    issues.push(issue("OBJECT_STORAGE_TIMEOUT_INVALID", "OBJECT_STORAGE_REQUEST_TIMEOUT_MS", `OBJECT_STORAGE_REQUEST_TIMEOUT_MS must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`));
    return DEFAULT_TIMEOUT_MS;
  }
  return timeout;
}

function value(raw: string | undefined): string {
  return String(raw ?? "").trim();
}

function issue(code: ObjectStorageConfigIssueCode, variable: string, message: string): ObjectStorageConfigIssue {
  return { code, variable, message };
}

function result(config: ObjectStorageConfig | null, issues: ObjectStorageConfigIssue[]): ObjectStorageConfigValidation {
  return { ok: issues.length === 0, config, issues };
}

function validateServerSideEncryption(
  raw: string,
  mode: ObjectStorageMode,
  issues: ObjectStorageConfigIssue[]
): ObjectStorageServerSideEncryption | null {
  if (!raw) {
    issues.push(issue(
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_REQUIRED",
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION",
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION must be configured explicitly when the s3 backend is active."
    ));
    return null;
  }
  if (raw !== "none" && raw !== "AES256" && raw !== "aws:kms") {
    issues.push(issue(
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_INVALID",
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION",
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION must be none, AES256, or aws:kms."
    ));
    return null;
  }
  if (mode === "production" && raw === "none") {
    issues.push(issue(
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_INVALID",
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION",
      "Production object storage requires AES256 or aws:kms server-side encryption."
    ));
    return null;
  }
  return raw;
}