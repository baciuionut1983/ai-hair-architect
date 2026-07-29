import { describe, expect, it } from "vitest";

import type { ObjectStorageErrorCode } from "./object-storage-errors";
import {
  assertM15RestoreDomain,
  assertM15V1ObjectReference,
  assertObjectWritesEnabled,
  M15_PROVIDER_CAPABILITIES,
  M15_PROVIDER_CAPABILITY_CONTRACT_VERSION,
  type M15ProviderCapabilityEvidence
} from "./object-storage-runtime";

const now = new Date("2026-07-27T12:00:00.000Z");

describe("object storage Phase 2 runtime contract", () => {
  it("accepts only complete exact m15.v1 references", () => {
    const reference = m15Reference();
    expect(assertM15V1ObjectReference(reference)).toBe(reference);
    expect(() => assertM15V1ObjectReference({ ...reference, versionId: "" })).toThrow("configured correctly");
    expect(() => assertM15V1ObjectReference({ ...reference, contentSha256: "ABC" })).toThrow("configured correctly");
    expect(() => assertM15V1ObjectReference({ ...reference, sizeBytes: 0 })).toThrow("configured correctly");
  });

  it("fails closed unless write mode and every current capability pass", () => {
    const evidence = capabilityEvidence();
    expect(assertObjectWritesEnabled({
      writeMode: "enabled",
      expectedBucketAlias: "images",
      evidence,
      now
    })).toBe(evidence);

    expect(() => assertObjectWritesEnabled({
      writeMode: "disabled",
      expectedBucketAlias: "images",
      evidence,
      now
    })).toThrow("state");
    expect(() => assertObjectWritesEnabled({
      writeMode: "enabled",
      expectedBucketAlias: "images",
      evidence: { ...evidence, expiresAt: now.toISOString() },
      now
    })).toThrow("capabilities");
    expect(() => assertObjectWritesEnabled({
      writeMode: "enabled",
      expectedBucketAlias: "images",
      evidence: {
        ...evidence,
        capabilities: { ...evidence.capabilities, bucket_versioning: "FAIL" }
      },
      now
    })).toThrow("capabilities");
  });

  it("rejects restore domains outside the frozen boundary", () => {
    expect(() => assertM15RestoreDomain("imageAssets")).not.toThrow();
    for (const domain of ["billing", "webhooks", "appointments", "auth", "notifications"]) {
      expect(() => assertM15RestoreDomain(domain)).toThrow("configured correctly");
    }
  });
});

function m15Reference() {
  return {
    backend: "s3" as const,
    bucketAlias: "images",
    key: "v1/owners/123e4567-e89b-42d3-a456-426614174000/assets/223e4567-e89b-42d3-a456-426614174000/original",
    versionId: "version-1",
    contentSha256: "a".repeat(64),
    sizeBytes: 3
  };
}

function capabilityEvidence(failureCodes: ObjectStorageErrorCode[] = []): M15ProviderCapabilityEvidence {
  return {
    contractVersion: M15_PROVIDER_CAPABILITY_CONTRACT_VERSION,
    backend: "s3",
    bucketAlias: "images",
    checkedAt: "2026-07-27T11:55:00.000Z",
    expiresAt: "2026-07-27T12:05:00.000Z",
    capabilities: Object.fromEntries(
      M15_PROVIDER_CAPABILITIES.map((capability) => [capability, "PASS"])
    ) as M15ProviderCapabilityEvidence["capabilities"],
    failureCodes
  };
}