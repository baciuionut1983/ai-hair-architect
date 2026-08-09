import { describe, expect, it, vi } from "vitest";

import {
  executeImageAssetRetentionPurge,
  ImageAssetRetentionError,
  type ImageAssetRetentionDatabase,
  type ImageAssetRetentionEligibleRow,
  type ImageAssetRetentionInput,
  type ImageAssetRetentionRunRow,
  type ImageAssetRetentionTransaction,
} from "./image-asset-retention";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-08-10T00:00:00.000Z");

function fixedNow(): Date {
  return NOW;
}

interface FakeImageAssetRow {
  id: string;
  ownerUserId: string;
  fileName: string;
  storageBackend: string | null;
  storageBucketAlias: string | null;
  storageKey: string | null;
  storageVersionId: string | null;
  storageState: string | null;
  deletedAt: Date | null;
  retentionDeletesAt: Date | null;
}

function localRow(overrides: Partial<FakeImageAssetRow> = {}): FakeImageAssetRow {
  return {
    id: "asset-local-1",
    ownerUserId: OWNER_ID,
    fileName: "photo.jpg",
    storageBackend: null,
    storageBucketAlias: null,
    storageKey: null,
    storageVersionId: null,
    storageState: null,
    deletedAt: new Date("2026-07-01T00:00:00.000Z"),
    retentionDeletesAt: new Date("2026-07-31T00:00:00.000Z"),
    ...overrides,
  };
}

function s3Row(overrides: Partial<FakeImageAssetRow> = {}): FakeImageAssetRow {
  return {
    id: "asset-s3-1",
    ownerUserId: OWNER_ID,
    fileName: "photo.png",
    storageBackend: "s3",
    storageBucketAlias: "primary-images",
    storageKey: "v1/owners/o/assets/asset-s3-1/original",
    storageVersionId: "version-1",
    storageState: "delete_pending",
    deletedAt: new Date("2026-07-01T00:00:00.000Z"),
    retentionDeletesAt: new Date("2026-07-31T00:00:00.000Z"),
    ...overrides,
  };
}

interface FakeDatabaseConfig {
  rows?: FakeImageAssetRow[];
  runs?: ImageAssetRetentionRunRow[];
  lockAcquired?: boolean;
}

function fakeDatabase(config: FakeDatabaseConfig = {}) {
  const rows: FakeImageAssetRow[] = [...(config.rows ?? [])];
  const runs: ImageAssetRetentionRunRow[] = [...(config.runs ?? [])];
  const deletedRowIds: string[] = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  const transactionCalls: number[] = [];
  let lockAcquired = config.lockAcquired ?? true;

  function findRun(ownerUserId: string, executionIdempotencyKey: string): ImageAssetRetentionRunRow | null {
    return runs.find((r) => r.ownerUserId === ownerUserId && r.executionIdempotencyKey === executionIdempotencyKey) ?? null;
  }

  const view: ImageAssetRetentionTransaction = {
    imageAsset: {
      deleteMany: vi.fn(async (args) => {
        const before = rows.length;
        const idSet = new Set(args.where.id.in);
        const survivors = rows.filter((r) => {
          const matches =
            r.ownerUserId === args.where.ownerUserId &&
            idSet.has(r.id) &&
            r.deletedAt !== null &&
            r.retentionDeletesAt !== null &&
            r.retentionDeletesAt.getTime() <= args.where.retentionDeletesAt.lte.getTime();
          if (matches) deletedRowIds.push(r.id);
          return !matches;
        });
        rows.length = 0;
        rows.push(...survivors);
        return { count: before - rows.length };
      }),
    },
    opsImageAssetRetentionRun: {
      findUnique: vi.fn(async (args) => {
        const key = args.where.ownerUserId_executionIdempotencyKey;
        return findRun(key.ownerUserId, key.executionIdempotencyKey);
      }),
      create: vi.fn(async (args) => {
        const row = { ...args.data } as unknown as ImageAssetRetentionRunRow;
        runs.push(row);
        return row;
      }),
      update: vi.fn(async (args) => {
        const row = runs.find((r) => r.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      }),
    },
    auditLog: {
      create: vi.fn(async (args) => {
        auditLogs.push(args.data as Record<string, unknown>);
        return args.data;
      }),
    },
    tryAcquireAdvisoryLock: vi.fn(async () => lockAcquired),
  };

  const database: ImageAssetRetentionDatabase = {
    imageAsset: {
      findMany: vi.fn(async (args) => {
        return rows
          .filter((r) => {
            if (r.ownerUserId !== args.where.ownerUserId) return false;
            if (r.deletedAt === null) return false;
            if (r.retentionDeletesAt === null || r.retentionDeletesAt.getTime() > args.where.retentionDeletesAt.lte.getTime()) return false;
            const matchesLocal = r.storageBackend === null;
            const matchesS3 = r.storageBackend === "s3" && r.storageState === "delete_pending";
            return matchesLocal || matchesS3;
          })
          .map((r): ImageAssetRetentionEligibleRow => ({
            id: r.id,
            ownerUserId: r.ownerUserId,
            fileName: r.fileName,
            storageBackend: r.storageBackend,
            storageBucketAlias: r.storageBucketAlias,
            storageKey: r.storageKey,
            storageVersionId: r.storageVersionId,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
      }),
    },
    opsImageAssetRetentionRun: {
      findUnique: vi.fn(async (args) => {
        const key = args.where.ownerUserId_executionIdempotencyKey;
        return findRun(key.ownerUserId, key.executionIdempotencyKey);
      }),
      create: vi.fn(async (args) => {
        const row = { ...args.data } as unknown as ImageAssetRetentionRunRow;
        runs.push(row);
        return row;
      }),
    },
    $transaction: vi.fn(async (fn) => {
      transactionCalls.push(1);
      return fn(view);
    }),
  };

  return {
    database,
    rows,
    runs,
    deletedRowIds,
    auditLogs,
    transactionCalls,
    setLockAcquired: (value: boolean) => {
      lockAcquired = value;
    },
  };
}

function baseInput(overrides: Partial<ImageAssetRetentionInput> = {}): ImageAssetRetentionInput {
  const { database } = fakeDatabase();
  return {
    ownerUserId: OWNER_ID,
    dryRun: true,
    correlationRequestId: "req-1",
    database,
    now: fixedNow,
    deleteS3Object: vi.fn(async () => undefined),
    deleteLocalFile: vi.fn(async () => "deleted" as const),
    writeDryRunAuditEvent: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("executeImageAssetRetentionPurge", () => {
  it("1. dry run counts eligible rows without mutating anything or touching storage", async () => {
    const fake = fakeDatabase({ rows: [localRow(), s3Row({ id: "asset-s3-2" })] });
    const deleteS3Object = vi.fn(async () => undefined);
    const deleteLocalFile = vi.fn(async () => "deleted" as const);
    const writeDryRunAuditEvent = vi.fn(async () => undefined);

    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: true, deleteS3Object, deleteLocalFile, writeDryRunAuditEvent }),
    );

    expect(result).toMatchObject({ status: "dry_run_completed", dryRun: true, eligibleCount: 2, purgedCount: 0, failedCount: 0 });
    expect(deleteS3Object).not.toHaveBeenCalled();
    expect(deleteLocalFile).not.toHaveBeenCalled();
    expect(fake.rows).toHaveLength(2);
    expect(writeDryRunAuditEvent).toHaveBeenCalledWith({ eligibleCount: 2, runId: expect.any(String) });
  });

  it("2. rejects execution without a valid confirmation token, touching nothing", async () => {
    const fake = fakeDatabase({ rows: [localRow()] });
    await expect(
      executeImageAssetRetentionPurge(baseInput({ database: fake.database, dryRun: false, confirmationToken: "wrong" })),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED", httpStatus: 400 });
    expect(fake.rows).toHaveLength(1);
  });

  it("3. purges an eligible legacy-local row: deletes the real file, then the DB row", async () => {
    const fake = fakeDatabase({ rows: [localRow()] });
    const deleteLocalFile = vi.fn(async () => "deleted" as const);

    const result = await executeImageAssetRetentionPurge(
      baseInput({
        database: fake.database,
        dryRun: false,
        confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION",
        deleteLocalFile,
      }),
    );

    expect(result).toMatchObject({ status: "execution_completed", eligibleCount: 1, purgedCount: 1, failedCount: 0 });
    expect(deleteLocalFile).toHaveBeenCalledWith({ ownerUserId: OWNER_ID, id: "asset-local-1", fileName: "photo.jpg" });
    expect(fake.rows).toHaveLength(0);
    expect(fake.deletedRowIds).toEqual(["asset-local-1"]);
  });

  it("4. purges an eligible S3-backed row using its exact captured identity (version-pinned)", async () => {
    const fake = fakeDatabase({ rows: [s3Row()] });
    const deleteS3Object = vi.fn(async () => undefined);

    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION", deleteS3Object }),
    );

    expect(result).toMatchObject({ status: "execution_completed", purgedCount: 1, failedCount: 0 });
    expect(deleteS3Object).toHaveBeenCalledWith({
      bucketAlias: "primary-images",
      key: "v1/owners/o/assets/asset-s3-1/original",
      versionId: "version-1",
    });
    expect(fake.rows).toHaveLength(0);
  });

  it("5. mixed local + S3 rows both purge in the same run", async () => {
    const fake = fakeDatabase({ rows: [localRow(), s3Row()] });
    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }),
    );
    expect(result).toMatchObject({ eligibleCount: 2, purgedCount: 2, failedCount: 0 });
    expect(fake.rows).toHaveLength(0);
  });

  it("6. fail-closed: an S3 delete failure excludes that row from the DB purge, while an unrelated eligible row still purges", async () => {
    const fake = fakeDatabase({ rows: [localRow({ id: "asset-local-2" }), s3Row()] });
    const deleteS3Object = vi.fn(async () => {
      throw new Error("S3_DELETE_FAILED");
    });

    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION", deleteS3Object }),
    );

    expect(result.purgedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failures).toEqual([{ id: "asset-s3-1", errorCode: "Error" }]);
    // The failed row must still exist -- never marked purged without its real object being cleared.
    expect(fake.rows.map((r) => r.id)).toEqual(["asset-s3-1"]);
  });

  it("7. fail-closed: a local delete failure (not idempotent-absent) excludes the row from the DB purge", async () => {
    const fake = fakeDatabase({ rows: [localRow()] });
    const deleteLocalFile = vi.fn(async () => {
      throw new Error("EACCES");
    });

    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION", deleteLocalFile }),
    );

    expect(result.purgedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(fake.rows).toHaveLength(1);
  });

  it("8. treats 'already_absent' local files as a successful purge (idempotent-safe)", async () => {
    const fake = fakeDatabase({ rows: [localRow()] });
    const deleteLocalFile = vi.fn(async () => "already_absent" as const);

    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION", deleteLocalFile }),
    );

    expect(result).toMatchObject({ purgedCount: 1, failedCount: 0 });
    expect(fake.rows).toHaveLength(0);
  });

  it("9. never touches an S3-backed row whose storageState is still 'available' despite deletedAt being set (conservative, fail-closed eligibility)", async () => {
    const inconsistentRow = s3Row({ storageState: "available" });
    const fake = fakeDatabase({ rows: [inconsistentRow] });
    const deleteS3Object = vi.fn(async () => undefined);

    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION", deleteS3Object }),
    );

    expect(result).toMatchObject({ eligibleCount: 0, purgedCount: 0, failedCount: 0 });
    expect(deleteS3Object).not.toHaveBeenCalled();
    expect(fake.rows).toHaveLength(1);
  });

  it("10. never touches a row that is not yet past its retention window", async () => {
    const notYetEligible = localRow({ id: "asset-future", retentionDeletesAt: new Date("2026-09-01T00:00:00.000Z") });
    const fake = fakeDatabase({ rows: [notYetEligible] });
    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }),
    );
    expect(result).toMatchObject({ eligibleCount: 0, purgedCount: 0 });
    expect(fake.rows).toHaveLength(1);
  });

  it("11. is strictly owner-scoped: never purges another owner's eligible row", async () => {
    const fake = fakeDatabase({ rows: [localRow({ id: "mine" }), localRow({ id: "theirs", ownerUserId: OTHER_OWNER_ID })] });
    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }),
    );
    expect(result.purgedCount).toBe(1);
    expect(fake.rows.map((r) => r.id)).toEqual(["theirs"]);
  });

  it("12. rejects with a conflict when the advisory lock cannot be acquired (a concurrent run is already in progress)", async () => {
    const fake = fakeDatabase({ rows: [localRow()], lockAcquired: false });
    await expect(
      executeImageAssetRetentionPurge(baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" })),
    ).rejects.toMatchObject({ code: "RETENTION_CONFLICT", httpStatus: 409 });
    // Row must survive: the lock guards the DB mutation, so losing it must
    // never leave a partial delete.
    expect(fake.rows).toHaveLength(1);
  });

  it("13. replays a previous execution result for the same idempotency key + payload, without re-touching storage", async () => {
    const fake = fakeDatabase({ rows: [localRow()] });
    const deleteLocalFile = vi.fn(async () => "deleted" as const);

    const first = await executeImageAssetRetentionPurge(
      baseInput({
        database: fake.database,
        dryRun: false,
        confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION",
        executionIdempotencyKey: "idem-1",
        deleteLocalFile,
      }),
    );
    expect(first.purgedCount).toBe(1);
    expect(deleteLocalFile).toHaveBeenCalledTimes(1);

    const second = await executeImageAssetRetentionPurge(
      baseInput({
        database: fake.database,
        dryRun: false,
        confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION",
        executionIdempotencyKey: "idem-1",
        deleteLocalFile,
      }),
    );

    expect(second.replayed).toBe(true);
    expect(second.runId).toBe(first.runId);
    // No new storage calls on replay -- the cached result is returned directly.
    expect(deleteLocalFile).toHaveBeenCalledTimes(1);
  });

  it("14. rejects reusing the same idempotency key with a different payload", async () => {
    const fake = fakeDatabase({ rows: [localRow()] });

    await executeImageAssetRetentionPurge(
      baseInput({
        database: fake.database,
        dryRun: false,
        confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION",
        executionIdempotencyKey: "idem-2",
        reason: "first",
      }),
    );

    await expect(
      executeImageAssetRetentionPurge(
        baseInput({
          database: fake.database,
          dryRun: false,
          confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION",
          executionIdempotencyKey: "idem-2",
          reason: "different-reason",
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", httpStatus: 409 });
  });

  it("15. succeeds trivially with zero eligible rows", async () => {
    const fake = fakeDatabase({ rows: [] });
    const result = await executeImageAssetRetentionPurge(
      baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }),
    );
    expect(result).toMatchObject({ eligibleCount: 0, purgedCount: 0, failedCount: 0, status: "execution_completed" });
  });

  it("16. is never imported by any HTTP route directly (source-level check, matching the M33 restore-execution convention)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.join(__dirname, "image-asset-retention.ts"), "utf8");
    expect(source).not.toMatch(/next\/server/);
    expect(source).not.toMatch(/@prisma\/client/);
    expect(source).not.toMatch(/from ["']\.\/prisma["']/);
  });

  it("17. does not mutate the input request object", async () => {
    const fake = fakeDatabase({ rows: [localRow()] });
    const input = baseInput({ database: fake.database, dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" });
    const before = { ...input, database: undefined, now: undefined, deleteS3Object: undefined, deleteLocalFile: undefined, writeDryRunAuditEvent: undefined };
    await executeImageAssetRetentionPurge(input);
    const after = { ...input, database: undefined, now: undefined, deleteS3Object: undefined, deleteLocalFile: undefined, writeDryRunAuditEvent: undefined };
    expect(after).toEqual(before);
  });

  it("throws ImageAssetRetentionError instances with safe, non-throwing constructors", () => {
    const error = new ImageAssetRetentionError("RETENTION_CONFLICT", 409, "conflict");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("RETENTION_CONFLICT");
    expect(error.httpStatus).toBe(409);
  });
});
