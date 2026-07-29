import type { ExactObjectReference } from "./object-storage";
import type { ObjectStorageWriteMode } from "./object-storage-config";
import { ObjectStorageError, type ObjectStorageErrorCode } from "./object-storage-errors";

export const M15_V1_SCHEMA_VERSION = "m15.v1" as const;
export const M15_PROVIDER_CAPABILITY_CONTRACT_VERSION = "m15.provider-capabilities.v1" as const;
export const MAX_M15_NORMALIZED_OBJECT_BYTES = 8 * 1024 * 1024;

export const M15_PROVIDER_CAPABILITIES = [
  "private_access",
  "bucket_versioning",
  "conditional_create",
  "custom_metadata",
  "configured_encryption",
  "exact_version_head",
  "exact_version_get",
  "exact_version_delete",
  "integrity",
  "bounded_timeout",
  "safe_error_classification"
] as const;

export const M15_RESTORE_ALLOWED_DOMAINS = [
  "clients",
  "analyses",
  "consultations",
  "imageAssets",
  "imageAnalyses",
  "imageAnalysisReviews"
] as const;

export const M15_RESTORE_PROHIBITED_DOMAINS = [
  "billing",
  "webhooks",
  "appointments",
  "auth",
  "notifications"
] as const;

export type M15ProviderCapability = typeof M15_PROVIDER_CAPABILITIES[number];
export type M15RestoreAllowedDomain = typeof M15_RESTORE_ALLOWED_DOMAINS[number];
export type M15RestoreProhibitedDomain = typeof M15_RESTORE_PROHIBITED_DOMAINS[number];

export type M15V1ObjectReference = Pick<
  ExactObjectReference,
  "backend" | "bucketAlias" | "key" | "versionId" | "contentSha256" | "sizeBytes"
>;

export interface M15ProviderCapabilityEvidence {
  contractVersion: typeof M15_PROVIDER_CAPABILITY_CONTRACT_VERSION;
  backend: "s3";
  bucketAlias: string;
  checkedAt: string;
  expiresAt: string;
  capabilities: Record<M15ProviderCapability, "PASS" | "FAIL">;
  failureCodes: ObjectStorageErrorCode[];
}

export interface ObjectWriteEligibilityInput {
  writeMode: ObjectStorageWriteMode;
  expectedBucketAlias: string;
  evidence: M15ProviderCapabilityEvidence | null;
  now?: Date;
}

const BUCKET_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const VERSION_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,1024}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OBJECT_KEY_PATTERN = /^v1\/owners\/[0-9a-f-]{36}\/assets\/[0-9a-f-]{36}\/original$/;

export function assertM15V1ObjectReference(value: M15V1ObjectReference): M15V1ObjectReference {
  if (
    value.backend !== "s3" ||
    !BUCKET_ALIAS_PATTERN.test(value.bucketAlias) ||
    !OBJECT_KEY_PATTERN.test(value.key) ||
    !VERSION_ID_PATTERN.test(value.versionId) ||
    !value.versionId.trim() ||
    !SHA256_PATTERN.test(value.contentSha256) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes <= 0 ||
    value.sizeBytes > MAX_M15_NORMALIZED_OBJECT_BYTES
  ) {
    throw new ObjectStorageError("configuration");
  }
  return value;
}

export function assertM15RestoreDomain(domain: string): asserts domain is M15RestoreAllowedDomain {
  if (!(M15_RESTORE_ALLOWED_DOMAINS as readonly string[]).includes(domain)) {
    throw new ObjectStorageError("configuration");
  }
}

export function assertObjectWritesEnabled(input: ObjectWriteEligibilityInput): M15ProviderCapabilityEvidence {
  if (input.writeMode !== "enabled") {
    throw new ObjectStorageError("invalid_state");
  }
  const evidence = input.evidence;
  const now = input.now ?? new Date();
  if (
    !evidence ||
    evidence.contractVersion !== M15_PROVIDER_CAPABILITY_CONTRACT_VERSION ||
    evidence.backend !== "s3" ||
    evidence.bucketAlias !== input.expectedBucketAlias ||
    !isFiniteTimestamp(evidence.checkedAt) ||
    !isFiniteTimestamp(evidence.expiresAt) ||
    Date.parse(evidence.checkedAt) > now.getTime() ||
    Date.parse(evidence.expiresAt) <= now.getTime() ||
    evidence.failureCodes.length > 0 ||
    M15_PROVIDER_CAPABILITIES.some((capability) => evidence.capabilities[capability] !== "PASS")
  ) {
    throw new ObjectStorageError("capability_unavailable");
  }
  return evidence;
}

function isFiniteTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}