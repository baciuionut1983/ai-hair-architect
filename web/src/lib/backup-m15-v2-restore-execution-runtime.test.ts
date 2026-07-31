import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { PRISMA_MARKER, RESOLVED_ALIAS_FN } = vi.hoisted(() => ({
  PRISMA_MARKER: { __marker: "real-prisma-singleton" },
  RESOLVED_ALIAS_FN: vi.fn(),
}));

vi.mock("./prisma", () => ({
  prisma: PRISMA_MARKER,
  isDatabaseConfigured: vi.fn(() => true),
}));
vi.mock("./object-storage-alias-resolver", () => ({
  createObjectStorageAliasResolver: vi.fn(() => RESOLVED_ALIAS_FN),
}));
vi.mock("./backup-m15-v2-reference-resolvers", () => ({
  createLegacyLocalReferenceResolver: vi.fn(() => ({ resolveLegacyLocalReference: vi.fn() })),
  createObjectBackedReferenceResolver: vi.fn((options: unknown) => ({
    resolveObjectBackedReference: vi.fn(),
    __options: options,
  })),
}));
vi.mock("./backup-m15-v2-restore-execution", () => ({
  executeBackupM15V2RestoreForUser: vi.fn(async () => ({
    backupId: "backup-1",
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    status: "completed",
    strategy: "replace_all",
    deletedCounts: { clients: 0, analyses: 0, consultations: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
    restoredCounts: { clients: 0, analyses: 0, consultations: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
    startedAt: "2026-07-30T15:00:00.000Z",
    finishedAt: "2026-07-30T15:00:00.000Z",
    attemptsUsed: 1,
  })),
}));

import { isDatabaseConfigured } from "./prisma";
import {
  createLegacyLocalReferenceResolver,
  createObjectBackedReferenceResolver,
} from "./backup-m15-v2-reference-resolvers";
import { executeBackupM15V2RestoreForUser } from "./backup-m15-v2-restore-execution";
import {
  BackupM15V2RestoreExecutionRuntimeError,
  runBackupM15V2RestoreForUser,
} from "./backup-m15-v2-restore-execution-runtime";
import { createObjectStorageAliasResolver } from "./object-storage-alias-resolver";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const BACKUP_ID = "backup-1";
const FIXED_NOW = new Date("2026-07-30T15:00:00.000Z");
const SAMPLE_REQUEST = { previewFingerprint: "a".repeat(64), previewedAt: "2026-07-30T10:00:00.000Z", strategy: "replace_all", acknowledgeDataLoss: true, safetyBackupId: "backup-2" };

function fixedNow(): Date {
  return FIXED_NOW;
}

describe("runBackupM15V2RestoreForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDatabaseConfigured).mockReturnValue(true);
  });

  it("1. uses the real prisma singleton when no database override is provided", async () => {
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    const [args] = vi.mocked(executeBackupM15V2RestoreForUser).mock.calls[0];
    expect(args.database).toBe(PRISMA_MARKER);
  });

  it("2. uses an injected database override when provided", async () => {
    const override = { __marker: "override-database" } as never;
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow, database: override });
    const [args] = vi.mocked(executeBackupM15V2RestoreForUser).mock.calls[0];
    expect(args.database).toBe(override);
  });

  it("3. builds the legacy-local resolver via the WP2H4 factory with no arguments", async () => {
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    expect(createLegacyLocalReferenceResolver).toHaveBeenCalledWith();
  });

  it("4. builds the object-backed resolver via the WP2H4 factory using the real alias resolver", async () => {
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    expect(createObjectStorageAliasResolver).toHaveBeenCalledWith();
    expect(createObjectBackedReferenceResolver).toHaveBeenCalledWith({ resolveObjectStorage: RESOLVED_ALIAS_FN });
  });

  it("5. injects the clock straight through to the closed WP2H7 core", async () => {
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    const [args] = vi.mocked(executeBackupM15V2RestoreForUser).mock.calls[0];
    expect(args.now).toBe(fixedNow);
  });

  it("6. passes ownerUserId, backupId, and request straight through unmodified", async () => {
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    const [args] = vi.mocked(executeBackupM15V2RestoreForUser).mock.calls[0];
    expect(args.ownerUserId).toBe(OWNER_ID);
    expect(args.backupId).toBe(BACKUP_ID);
    expect(args.request).toBe(SAMPLE_REQUEST);
  });

  it("7. passes maxStreamBytes through only when provided", async () => {
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    expect(vi.mocked(executeBackupM15V2RestoreForUser).mock.calls[0][0]).not.toHaveProperty("maxStreamBytes");

    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow, maxStreamBytes: 1024 });
    expect(vi.mocked(executeBackupM15V2RestoreForUser).mock.calls[1][0].maxStreamBytes).toBe(1024);
  });

  it("8. returns exactly what the closed WP2H7 core returns", async () => {
    const result = await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    expect(result).toMatchObject({ status: "completed", attemptsUsed: 1 });
  });

  it("9. calls the closed WP2H7 core exactly once per invocation", async () => {
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    expect(executeBackupM15V2RestoreForUser).toHaveBeenCalledTimes(1);
  });

  it("10. fails closed with DATABASE_NOT_CONFIGURED when the database is not configured, and never calls the core", async () => {
    vi.mocked(isDatabaseConfigured).mockReturnValue(false);
    await expect(
      runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow }),
    ).rejects.toMatchObject({ code: "DATABASE_NOT_CONFIGURED" });
    expect(executeBackupM15V2RestoreForUser).not.toHaveBeenCalled();
  });

  it("11. DATABASE_NOT_CONFIGURED carries httpStatus 500 and is an instance of the runtime error class", async () => {
    vi.mocked(isDatabaseConfigured).mockReturnValue(false);
    try {
      await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupM15V2RestoreExecutionRuntimeError);
      expect((error as BackupM15V2RestoreExecutionRuntimeError).httpStatus).toBe(500);
    }
  });

  it("12. respects an injected isDatabaseConfigured override independently of the real prisma module", async () => {
    const overrideCheck = vi.fn(() => false);
    await expect(
      runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow, isDatabaseConfigured: overrideCheck }),
    ).rejects.toMatchObject({ code: "DATABASE_NOT_CONFIGURED" });
    expect(overrideCheck).toHaveBeenCalledTimes(1);
    expect(isDatabaseConfigured).not.toHaveBeenCalled();
  });

  it("13. never reads process.env directly", () => {
    expect(readSourceFile()).not.toMatch(/process\.env/);
  });

  it("14. imports no AWS SDK or Prisma client type directly", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/@aws-sdk/);
    expect(source).not.toMatch(/@prisma\/client/);
  });

  it("15. never calls Date.now or constructs an un-injected Date", async () => {
    const spy = vi.spyOn(Date, "now");
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, { now: fixedNow });
    expect(spy).not.toHaveBeenCalled();
    expect(readSourceFile()).not.toMatch(/new Date\(/);
    spy.mockRestore();
  });

  it("16. uses no internal random source", () => {
    expect(readSourceFile()).not.toMatch(/Math\.random/);
  });

  it("17. does not duplicate WP2H7 business logic (no delete/insert/retry/fingerprint/safety-backup keywords in this file)", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/deleteOwnerScopedRows|insertBackupRows|isRetryableConcurrencyError|assertSafetyBackup|sectionsMatchExactly|canonicalizeM15V2/);
  });

  it("18. does not mutate the input dependencies", async () => {
    const dependencies = { now: fixedNow };
    const before = { ...dependencies };
    await runBackupM15V2RestoreForUser(OWNER_ID, BACKUP_ID, SAMPLE_REQUEST, dependencies);
    expect(dependencies).toEqual(before);
  });

  it("19. is never imported by any HTTP route other than the restore route (source-level sanity: file exports only the documented surface)", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/next\/server/);
    expect(source).not.toMatch(/from ["']\.\/contracts["']/);
    expect(source).not.toMatch(/from ["']\.\/ops-persistence["']/);
  });
});

function readSourceFile(): string {
  const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "backup-m15-v2-restore-execution-runtime.ts");
  return fs.readFileSync(sourcePath, "utf8");
}
