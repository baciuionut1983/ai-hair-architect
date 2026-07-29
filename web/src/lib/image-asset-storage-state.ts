import { buildImageAssetObjectKey } from "./object-storage";

export type ImageAssetStorageState =
  | "pending_upload"
  | "available"
  | "delete_pending"
  | "deleted"
  | "quarantined";

export type Phase2StorageTransition = Readonly<{
  from: "pending_upload" | "available";
  to: "available" | "quarantined" | "delete_pending";
}>;

export interface ImageAssetStorageOperationIdentity {
  operationId: string;
  ownerUserId: string;
  assetId: string;
  relativeKey: string;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,190}$/;

const PHASE2_TRANSITIONS: Readonly<Record<ImageAssetStorageState, readonly ImageAssetStorageState[]>> = {
  pending_upload: ["available", "quarantined", "delete_pending"],
  available: ["delete_pending"],
  delete_pending: [],
  deleted: [],
  quarantined: []
};

export function canTransitionImageAssetStorageState(
  from: ImageAssetStorageState,
  to: ImageAssetStorageState
): boolean {
  return PHASE2_TRANSITIONS[from].includes(to);
}

export function assertPhase2StorageTransition(
  from: ImageAssetStorageState,
  to: ImageAssetStorageState
): asserts from is Phase2StorageTransition["from"] {
  if (!canTransitionImageAssetStorageState(from, to)) {
    throw new TypeError(`Storage transition ${from} -> ${to} is not allowed in Phase 2.`);
  }
}

export function createImageAssetStorageOperationIdentity(
  ownerUserId: string,
  assetId: string
): ImageAssetStorageOperationIdentity {
  return {
    operationId: assetId,
    ownerUserId,
    assetId,
    relativeKey: buildImageAssetObjectKey(ownerUserId, assetId)
  };
}

export function assertStorageIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new TypeError("A valid storage idempotency key is required.");
  }
  return value;
}