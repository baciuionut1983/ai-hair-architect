import type { BackupM15V2ExternalReferenceVerificationResult } from "./backup-m15-v2-external-reference-verifier";
import {
  createLegacyLocalReferenceResolver,
  createObjectBackedReferenceResolver,
} from "./backup-m15-v2-reference-resolvers";
import { generateBackupId } from "./backup-v13-artifact";
import {
  createBackupM15V2Snapshot,
  verifyBackupM15V2Snapshot,
  type BackupM15V2SnapshotPersistenceDatabase,
  type BackupM15V2SnapshotRecord,
} from "./backup-m15-v2-snapshot-persistence";
import { createObjectStorageAliasResolver } from "./object-storage-alias-resolver";
import { writeOpsAuditEvent } from "./ops-persistence";
import { prisma } from "./prisma";

export interface CreateBackupM15V2SnapshotForUserDependencies {
  readonly database?: BackupM15V2SnapshotPersistenceDatabase;
  // Required, not defaulted: the creation instant is the only non-deterministic
  // value this wiring needs, and it is injected explicitly by the caller (the route).
  readonly now: () => Date;
  readonly generateId?: () => string;
}

export async function createBackupM15V2SnapshotForUser(
  ownerUserId: string,
  createdByUserId: string,
  label: string,
  dependencies: CreateBackupM15V2SnapshotForUserDependencies,
): Promise<BackupM15V2SnapshotRecord> {
  const database = dependencies.database ?? (prisma as unknown as BackupM15V2SnapshotPersistenceDatabase);

  const record = await createBackupM15V2Snapshot({
    ownerUserId,
    createdByUserId,
    label,
    database,
    generateId: dependencies.generateId ?? generateBackupId,
    now: dependencies.now,
  });

  await writeOpsAuditEvent({
    actorUserId: ownerUserId,
    action: "ops.backup.created",
    status: "success",
    correlationRequestId: record.id,
    resourceId: record.id,
    metadata: {
      checksum: record.checksum,
      checksumAlgorithm: record.checksumAlgorithm,
      schemaVersion: record.schemaVersion,
      label,
    },
  });

  return record;
}

export interface VerifyBackupM15V2SnapshotForUserDependencies {
  readonly database?: BackupM15V2SnapshotPersistenceDatabase;
  // Required, not defaulted: the verification instant is the only non-deterministic
  // value this wiring needs, and it is injected explicitly by the caller (the route).
  readonly now: () => Date;
  readonly maxStreamBytes?: number;
}

export async function verifyBackupM15V2SnapshotForUser(
  ownerUserId: string,
  backupId: string,
  dependencies: VerifyBackupM15V2SnapshotForUserDependencies,
): Promise<BackupM15V2ExternalReferenceVerificationResult> {
  const database = dependencies.database ?? (prisma as unknown as BackupM15V2SnapshotPersistenceDatabase);
  const legacyLocalResolver = createLegacyLocalReferenceResolver();
  const objectBackedResolver = createObjectBackedReferenceResolver({
    resolveObjectStorage: createObjectStorageAliasResolver(),
  });

  return verifyBackupM15V2Snapshot({
    ownerUserId,
    backupId,
    database,
    verifiedAt: dependencies.now().toISOString(),
    legacyLocalResolver,
    objectBackedResolver,
    ...(dependencies.maxStreamBytes === undefined ? {} : { maxStreamBytes: dependencies.maxStreamBytes }),
  });
}
