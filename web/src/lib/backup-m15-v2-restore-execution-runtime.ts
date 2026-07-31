import {
  createLegacyLocalReferenceResolver,
  createObjectBackedReferenceResolver,
} from "./backup-m15-v2-reference-resolvers";
import {
  executeBackupM15V2RestoreForUser,
  type BackupM15V2RestoreExecutionDatabase,
  type BackupM15V2RestoreExecutionResult,
} from "./backup-m15-v2-restore-execution";
import { createObjectStorageAliasResolver } from "./object-storage-alias-resolver";
import { isDatabaseConfigured, prisma } from "./prisma";

export type BackupM15V2RestoreExecutionRuntimeErrorCode = "DATABASE_NOT_CONFIGURED";

export class BackupM15V2RestoreExecutionRuntimeError extends Error {
  readonly code: BackupM15V2RestoreExecutionRuntimeErrorCode;
  readonly httpStatus: number;

  constructor(code: BackupM15V2RestoreExecutionRuntimeErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "BackupM15V2RestoreExecutionRuntimeError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface RunBackupM15V2RestoreForUserDependencies {
  readonly database?: BackupM15V2RestoreExecutionDatabase;
  readonly isDatabaseConfigured?: () => boolean;
  // Required, not defaulted: every temporal value the closed WP2H7 core needs
  // (startedAt/finishedAt) comes from this single injected clock seam, supplied
  // by the HTTP route boundary -- the only approved place a real clock may exist.
  readonly now: () => Date;
  readonly maxStreamBytes?: number;
}

export async function runBackupM15V2RestoreForUser(
  ownerUserId: string,
  backupId: string,
  request: unknown,
  dependencies: RunBackupM15V2RestoreForUserDependencies,
): Promise<BackupM15V2RestoreExecutionResult> {
  const databaseConfigured = dependencies.isDatabaseConfigured ?? isDatabaseConfigured;
  if (!databaseConfigured()) {
    throw new BackupM15V2RestoreExecutionRuntimeError(
      "DATABASE_NOT_CONFIGURED",
      500,
      "Backup restore requires a configured database.",
    );
  }

  const database = dependencies.database ?? (prisma as unknown as BackupM15V2RestoreExecutionDatabase);
  const legacyLocalResolver = createLegacyLocalReferenceResolver();
  const objectBackedResolver = createObjectBackedReferenceResolver({
    resolveObjectStorage: createObjectStorageAliasResolver(),
  });

  return executeBackupM15V2RestoreForUser({
    ownerUserId,
    backupId,
    request,
    database,
    legacyLocalResolver,
    objectBackedResolver,
    now: dependencies.now,
    ...(dependencies.maxStreamBytes === undefined ? {} : { maxStreamBytes: dependencies.maxStreamBytes }),
  });
}
