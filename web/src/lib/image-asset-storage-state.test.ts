import { describe, expect, it } from "vitest";

import {
  assertPhase2StorageTransition,
  assertStorageIdempotencyKey,
  canTransitionImageAssetStorageState,
  createImageAssetStorageOperationIdentity
} from "./image-asset-storage-state";

const ownerUserId = "123e4567-e89b-42d3-a456-426614174000";
const assetId = "223e4567-e89b-42d3-a456-426614174000";

describe("image asset storage state contract", () => {
  it("allows only the frozen Phase 2 transitions", () => {
    expect(canTransitionImageAssetStorageState("pending_upload", "available")).toBe(true);
    expect(canTransitionImageAssetStorageState("pending_upload", "quarantined")).toBe(true);
    expect(canTransitionImageAssetStorageState("pending_upload", "delete_pending")).toBe(true);
    expect(canTransitionImageAssetStorageState("available", "delete_pending")).toBe(true);
    expect(canTransitionImageAssetStorageState("delete_pending", "available")).toBe(false);
    expect(canTransitionImageAssetStorageState("deleted", "available")).toBe(false);
    expect(canTransitionImageAssetStorageState("quarantined", "available")).toBe(false);
    expect(() => assertPhase2StorageTransition("available", "pending_upload")).toThrow("not allowed");
  });

  it("uses the asset UUID as the durable operation identity", () => {
    expect(createImageAssetStorageOperationIdentity(ownerUserId, assetId)).toEqual({
      operationId: assetId,
      ownerUserId,
      assetId,
      relativeKey: `owners/${ownerUserId}/assets/${assetId}/original`
    });
  });

  it("validates bounded idempotency keys", () => {
    expect(assertStorageIdempotencyKey("upload:223e4567-e89b-42d3-a456-426614174000")).toContain("upload:");
    expect(() => assertStorageIdempotencyKey("contains spaces")).toThrow("idempotency");
    expect(() => assertStorageIdempotencyKey("a".repeat(191))).toThrow("idempotency");
  });
});