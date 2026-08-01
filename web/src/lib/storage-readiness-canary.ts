import { createHash, randomUUID } from "crypto";

import type { ObjectStorage } from "./object-storage";
import { toExactObjectReference } from "./object-storage";
import {
  validateObjectStorageConfig,
  validateObjectStorageWriteMode,
  type ObjectStorageMode,
  type S3ObjectStorageConfig,
} from "./object-storage-config";
import { createObjectStorageAliasResolver } from "./object-storage-alias-resolver";
import { ObjectStorageError } from "./object-storage-errors";

export type StorageReadinessStatus = "READY" | "NOT_READY";

export type StorageReadinessCode =
  | "STORAGE_READINESS_CANARY_DISABLED"
  | "STORAGE_CONFIGURATION_INVALID"
  | "STORAGE_WRITE_MODE_DISABLED"
  | "STORAGE_CANARY_TIMEOUT"
  | "STORAGE_CANARY_WRITE_FAILED"
  | "STORAGE_CANARY_INTEGRITY_FAILED"
  | "STORAGE_CANARY_READ_FAILED"
  | "STORAGE_CANARY_DELETE_FAILED"
  | "STORAGE_CANARY_DELETE_UNCONFIRMED"
  | "STORAGE_CANARY_SUCCEEDED";

export interface StorageReadinessResult {
  readonly status: StorageReadinessStatus;
  readonly code: StorageReadinessCode;
  readonly message: string;
}

const SAFE_MESSAGES: Record<StorageReadinessCode, string> = {
  STORAGE_READINESS_CANARY_DISABLED: "Storage readiness canary is not enabled.",
  STORAGE_CONFIGURATION_INVALID: "Object storage configuration is not production-safe.",
  STORAGE_WRITE_MODE_DISABLED: "Object storage write mode is not enabled.",
  STORAGE_CANARY_TIMEOUT: "Storage readiness canary did not complete in time.",
  STORAGE_CANARY_WRITE_FAILED: "Storage readiness canary write did not succeed.",
  STORAGE_CANARY_INTEGRITY_FAILED: "Storage readiness canary integrity verification did not succeed.",
  STORAGE_CANARY_READ_FAILED: "Storage readiness canary read did not succeed.",
  STORAGE_CANARY_DELETE_FAILED: "Storage readiness canary cleanup did not succeed.",
  STORAGE_CANARY_DELETE_UNCONFIRMED: "Storage readiness canary deletion could not be confirmed.",
  STORAGE_CANARY_SUCCEEDED: "Storage readiness canary succeeded.",
};

const SUCCESS_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;
const CANARY_TIMEOUT_MS = 15_000;
const CANARY_PAYLOAD_MARKER = "aha-storage-readiness-canary-v1";
const MAX_PAYLOAD_BYTES = 256;
const CANARY_NAMESPACE = "internal/readiness-canary";

type ObjectStorageResolver = (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>;

export interface StorageReadinessCanaryDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly mode: ObjectStorageMode;
  // Required, not defaulted: every temporal value this module needs (cache
  // timestamps, TTL comparisons) comes from this single injected clock seam,
  // supplied by the caller (production-guards.ts, itself fed from the HTTP
  // route boundary).
  readonly now: () => Date;
  readonly resolveObjectStorage?: ObjectStorageResolver;
}

interface CacheEntry {
  readonly result: StorageReadinessResult;
  readonly cachedAt: number;
  readonly configIdentity: string;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<StorageReadinessResult> | null = null;
let inFlightConfigIdentity: string | null = null;

// Test-only reset seam. Process-local module state must never leak between
// test cases (or, in principle, between requests in a way that outlives a
// process restart -- the whole point of "process-local only, cleared on
// restart").
export function resetStorageReadinessCanaryStateForTests(): void {
  cache = null;
  inFlight = null;
  inFlightConfigIdentity = null;
}

export async function evaluateStorageReadiness(
  deps: StorageReadinessCanaryDependencies,
): Promise<StorageReadinessResult> {
  const startedAt = deps.now().getTime();

  if (!isCanaryEnabled(deps.env)) {
    const result = fail("STORAGE_READINESS_CANARY_DISABLED");
    logOutcome({ result, cacheHit: false, durationMs: deps.now().getTime() - startedAt, cleanupAttempted: false, cleanupSucceeded: null });
    return result;
  }

  const configValidation = validateObjectStorageConfig(deps.env, deps.mode);
  if (!configValidation.ok || !configValidation.config || configValidation.config.backend !== "s3") {
    const result = fail("STORAGE_CONFIGURATION_INVALID");
    logOutcome({ result, cacheHit: false, durationMs: deps.now().getTime() - startedAt, cleanupAttempted: false, cleanupSucceeded: null });
    return result;
  }

  const writeMode = validateObjectStorageWriteMode(deps.env);
  if (writeMode.mode !== "enabled") {
    const result = fail("STORAGE_WRITE_MODE_DISABLED");
    logOutcome({ result, cacheHit: false, durationMs: deps.now().getTime() - startedAt, cleanupAttempted: false, cleanupSucceeded: null });
    return result;
  }

  const config = configValidation.config;
  const configIdentity = computeConfigIdentity(config);

  if (cache && cache.configIdentity === configIdentity) {
    const ttl = cache.result.status === "READY" ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    if (startedAt - cache.cachedAt < ttl) {
      logOutcome({ result: cache.result, cacheHit: true, durationMs: deps.now().getTime() - startedAt, cleanupAttempted: false, cleanupSucceeded: null });
      return cache.result;
    }
  }

  if (inFlight && inFlightConfigIdentity === configIdentity) {
    return inFlight;
  }

  const resolveObjectStorage = deps.resolveObjectStorage ?? createObjectStorageAliasResolver();
  const execution = executeCanaryAndRecord(resolveObjectStorage, config, deps.now, configIdentity, startedAt);

  inFlight = execution;
  inFlightConfigIdentity = configIdentity;
  // Cleared on both success and failure -- a rejected/timed-out attempt must
  // not permanently block future refresh attempts.
  void execution.finally(() => {
    if (inFlightConfigIdentity === configIdentity) {
      inFlight = null;
      inFlightConfigIdentity = null;
    }
  });

  return execution;
}

async function executeCanaryAndRecord(
  resolveObjectStorage: ObjectStorageResolver,
  config: S3ObjectStorageConfig,
  now: () => Date,
  configIdentity: string,
  startedAt: number,
): Promise<StorageReadinessResult> {
  const outcome = await runCanaryWithTimeout(resolveObjectStorage, config);
  cache = { result: outcome.result, cachedAt: now().getTime(), configIdentity };
  logOutcome({
    result: outcome.result,
    cacheHit: false,
    durationMs: now().getTime() - startedAt,
    cleanupAttempted: outcome.cleanupAttempted,
    cleanupSucceeded: outcome.cleanupSucceeded,
  });
  return outcome.result;
}

interface CanaryExecutionOutcome {
  readonly result: StorageReadinessResult;
  readonly cleanupAttempted: boolean;
  readonly cleanupSucceeded: boolean | null;
}

async function runCanaryWithTimeout(
  resolveObjectStorage: ObjectStorageResolver,
  config: S3ObjectStorageConfig,
): Promise<CanaryExecutionOutcome> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CanaryExecutionOutcome>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({ result: fail("STORAGE_CANARY_TIMEOUT"), cleanupAttempted: false, cleanupSucceeded: null });
    }, CANARY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([runCanary(resolveObjectStorage, config), timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

interface WrittenIdentity {
  readonly bucketAlias: string;
  readonly key: string;
  readonly versionId: string;
}

async function runCanary(
  resolveObjectStorage: ObjectStorageResolver,
  config: S3ObjectStorageConfig,
): Promise<CanaryExecutionOutcome> {
  const storage = await Promise.resolve(resolveObjectStorage(config.bucketAlias)).catch(() => null);
  if (!storage) {
    return { result: fail("STORAGE_CANARY_WRITE_FAILED"), cleanupAttempted: false, cleanupSucceeded: null };
  }

  const canaryId = randomUUID();
  const payload = buildCanaryPayload(canaryId);
  const contentSha256 = sha256Hex(payload);
  const relativeKey = `${CANARY_NAMESPACE}/${canaryId}`;

  const core = await runCoreLifecycle(storage, relativeKey, payload, contentSha256);

  if (!core.writtenIdentity) {
    return { result: core.result, cleanupAttempted: false, cleanupSucceeded: null };
  }

  const cleanup = await cleanupCanaryObject(storage, core.writtenIdentity);
  const cleanupSucceeded = cleanup.deleteSucceeded && cleanup.deletionConfirmed;

  if (core.result.status !== "READY") {
    // The original failure reason is always reported -- a cleanup outcome
    // never overrides or masks it.
    return { result: core.result, cleanupAttempted: true, cleanupSucceeded };
  }
  if (!cleanup.deleteSucceeded) {
    return { result: fail("STORAGE_CANARY_DELETE_FAILED"), cleanupAttempted: true, cleanupSucceeded: false };
  }
  if (!cleanup.deletionConfirmed) {
    return { result: fail("STORAGE_CANARY_DELETE_UNCONFIRMED"), cleanupAttempted: true, cleanupSucceeded: false };
  }
  return { result: core.result, cleanupAttempted: true, cleanupSucceeded: true };
}

interface CoreLifecycleOutcome {
  readonly result: StorageReadinessResult;
  readonly writtenIdentity: WrittenIdentity | null;
}

async function runCoreLifecycle(
  storage: ObjectStorage,
  relativeKey: string,
  payload: Uint8Array,
  contentSha256: string,
): Promise<CoreLifecycleOutcome> {
  const reference = await storage
    .put({ key: relativeKey, body: payload, contentType: "application/octet-stream", contentSha256 })
    .catch(() => null);
  if (!reference) {
    return { result: fail("STORAGE_CANARY_WRITE_FAILED"), writtenIdentity: null };
  }

  let exact;
  try {
    exact = toExactObjectReference(reference);
  } catch {
    const fallbackIdentity: WrittenIdentity | null = reference.versionId
      ? { bucketAlias: reference.bucketAlias, key: reference.key, versionId: reference.versionId }
      : null;
    return { result: fail("STORAGE_CANARY_INTEGRITY_FAILED"), writtenIdentity: fallbackIdentity };
  }
  const writtenIdentity: WrittenIdentity = { bucketAlias: exact.bucketAlias, key: exact.key, versionId: exact.versionId };

  if (exact.contentSha256 !== contentSha256 || exact.sizeBytes !== payload.byteLength) {
    return { result: fail("STORAGE_CANARY_INTEGRITY_FAILED"), writtenIdentity };
  }

  const headResult = await storage
    .head({ bucketAlias: exact.bucketAlias, key: exact.key, versionId: exact.versionId })
    .catch(() => null);
  if (!headResult) {
    return { result: fail("STORAGE_CANARY_READ_FAILED"), writtenIdentity };
  }
  if (
    headResult.versionId !== exact.versionId ||
    headResult.contentSha256 !== contentSha256 ||
    headResult.sizeBytes !== payload.byteLength
  ) {
    return { result: fail("STORAGE_CANARY_INTEGRITY_FAILED"), writtenIdentity };
  }

  const stored = await storage
    .get({ bucketAlias: exact.bucketAlias, key: exact.key, versionId: exact.versionId })
    .catch(() => null);
  if (!stored) {
    return { result: fail("STORAGE_CANARY_READ_FAILED"), writtenIdentity };
  }
  const downloadedBytes = await readAllBytes(stored.body).catch(() => null);
  if (!downloadedBytes) {
    return { result: fail("STORAGE_CANARY_READ_FAILED"), writtenIdentity };
  }
  const downloadedSha256 = sha256Hex(downloadedBytes);
  if (
    stored.versionId !== exact.versionId ||
    stored.contentSha256 !== contentSha256 ||
    downloadedBytes.byteLength !== payload.byteLength ||
    downloadedSha256 !== contentSha256
  ) {
    return { result: fail("STORAGE_CANARY_INTEGRITY_FAILED"), writtenIdentity };
  }

  return {
    result: { status: "READY", code: "STORAGE_CANARY_SUCCEEDED", message: SAFE_MESSAGES.STORAGE_CANARY_SUCCEEDED },
    writtenIdentity,
  };
}

interface CleanupOutcome {
  readonly deleteSucceeded: boolean;
  readonly deletionConfirmed: boolean;
}

async function cleanupCanaryObject(storage: ObjectStorage, identity: WrittenIdentity): Promise<CleanupOutcome> {
  const deleteSucceeded = await storage
    .delete(identity)
    .then(() => true)
    .catch(() => false);

  let deletionConfirmed: boolean;
  try {
    await storage.head(identity);
    // head() succeeding means the object/version is still visible: deletion
    // did not actually take effect, regardless of what delete() reported.
    deletionConfirmed = false;
  } catch (error) {
    deletionConfirmed = error instanceof ObjectStorageError && error.code === "not_found";
  }

  return { deleteSucceeded, deletionConfirmed };
}

function isCanaryEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.STORAGE_READINESS_CANARY_ENABLED === "true";
}

function computeConfigIdentity(config: S3ObjectStorageConfig): string {
  // Deliberately excludes AWS credentials (never part of this config object
  // in the first place -- the SDK's own credential chain supplies them) and
  // is hashed rather than stored as plain text, so the cache never holds a
  // directly-readable copy of the effective configuration.
  const material = JSON.stringify({
    bucketAlias: config.bucketAlias,
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint ?? null,
    forcePathStyle: config.forcePathStyle,
    serverSideEncryption: config.serverSideEncryption,
    kmsKeyId: config.kmsKeyId ?? null,
    prefix: config.prefix,
  });
  return sha256Hex(new TextEncoder().encode(material));
}

function buildCanaryPayload(canaryId: string): Uint8Array {
  // marker (~30 bytes) + ":" + a UUID (36 bytes) is always far under the
  // 256-byte bound; no infrastructure, environment, account, or customer
  // data is ever included.
  const bytes = new TextEncoder().encode(`${CANARY_PAYLOAD_MARKER}:${canaryId}`);
  return bytes.slice(0, MAX_PAYLOAD_BYTES);
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(code: StorageReadinessCode): StorageReadinessResult {
  return { status: "NOT_READY", code, message: SAFE_MESSAGES[code] };
}

function bucketDurationMs(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 5000) return "1-5s";
  if (ms < 15000) return "5-15s";
  return ">=15s";
}

function logOutcome(input: {
  result: StorageReadinessResult;
  cacheHit: boolean;
  durationMs: number;
  cleanupAttempted: boolean;
  cleanupSucceeded: boolean | null;
}): void {
  const record = {
    gate: "STORAGE_PRODUCTION_POLICY_READY",
    status: input.result.status,
    code: input.result.code,
    durationBucket: bucketDurationMs(Math.max(0, input.durationMs)),
    cacheHit: input.cacheHit,
    cleanupAttempted: input.cleanupAttempted,
    cleanupSucceeded: input.cleanupSucceeded,
  };
  if (input.result.status === "READY") {
    console.log(JSON.stringify(record));
  } else {
    console.warn(JSON.stringify(record));
  }
}
