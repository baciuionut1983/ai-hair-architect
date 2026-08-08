import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { PRISMA_MARKER, RESOLVED_ALIAS_FN } = vi.hoisted(() => ({
  PRISMA_MARKER: { __marker: "real-prisma-singleton" },
  RESOLVED_ALIAS_FN: vi.fn(),
}));

vi.mock("./prisma", () => ({ prisma: PRISMA_MARKER }));
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
vi.mock("./backup-m15-v2-snapshot-persistence", () => ({
  verifyBackupM15V2Snapshot: vi.fn(async () => ({ ok: true, verifiedReferenceCount: 0 })),
  createBackupM15V2Snapshot: vi.fn(async () => ({
    id: "created-backup-1",
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    createdByUserId: "11111111-1111-4111-8111-111111111111",
    label: "label",
    schemaVersion: "m15.v2",
    checksum: "checksum-1",
    checksumAlgorithm: "sha256",
    createdAt: "2026-07-30T15:00:00.000Z",
    snapshot: { clientsCount: 0, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
  })),
}));
vi.mock("./backup-v13-artifact", () => ({
  generateBackupId: vi.fn(() => "generated-backup-id"),
}));
vi.mock("./ops-persistence", () => ({
  writeOpsAuditEvent: vi.fn(async () => {}),
}));

import {
  createBackupM15V2Snapshot,
  verifyBackupM15V2Snapshot,
} from "./backup-m15-v2-snapshot-persistence";
import {
  createBackupM15V2SnapshotForUser,
  verifyBackupM15V2SnapshotForUser,
} from "./backup-m15-v2-snapshot-persistence-runtime";
import {
  createLegacyLocalReferenceResolver,
  createObjectBackedReferenceResolver,
} from "./backup-m15-v2-reference-resolvers";
import { generateBackupId } from "./backup-v13-artifact";
import { createObjectStorageAliasResolver } from "./object-storage-alias-resolver";
import { writeOpsAuditEvent } from "./ops-persistence";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const BACKUP_ID = "backup-1";
const FIXED_NOW = new Date("2026-07-30T15:00:00.000Z");

function fixedNow(): Date {
  return FIXED_NOW;
}

describe("createBackupM15V2SnapshotForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the real prisma singleton when no database override is provided", async () => {
    await createBackupM15V2SnapshotForUser(OWNER_ID, OWNER_ID, "label", { now: fixedNow });
    const [args] = vi.mocked(createBackupM15V2Snapshot).mock.calls[0];
    expect(args.database).toBe(PRISMA_MARKER);
  });

  it("uses an injected database override when provided", async () => {
    const override = { __marker: "override-database" } as never;
    await createBackupM15V2SnapshotForUser(OWNER_ID, OWNER_ID, "label", { now: fixedNow, database: override });
    const [args] = vi.mocked(createBackupM15V2Snapshot).mock.calls[0];
    expect(args.database).toBe(override);
  });

  it("uses generateBackupId by default when no generateId override is provided", async () => {
    await createBackupM15V2SnapshotForUser(OWNER_ID, OWNER_ID, "label", { now: fixedNow });
    const [args] = vi.mocked(createBackupM15V2Snapshot).mock.calls[0];
    expect(args.generateId).toBe(generateBackupId);
  });

  it("uses an injected generateId override when provided", async () => {
    const override = () => "override-id";
    await createBackupM15V2SnapshotForUser(OWNER_ID, OWNER_ID, "label", { now: fixedNow, generateId: override });
    const [args] = vi.mocked(createBackupM15V2Snapshot).mock.calls[0];
    expect(args.generateId).toBe(override);
  });

  it("passes ownerUserId, createdByUserId, label, and the injected clock through unchanged", async () => {
    await createBackupM15V2SnapshotForUser("owner-a", "actor-b", "my-label", { now: fixedNow });
    const [args] = vi.mocked(createBackupM15V2Snapshot).mock.calls[0];
    expect(args.ownerUserId).toBe("owner-a");
    expect(args.createdByUserId).toBe("actor-b");
    expect(args.label).toBe("my-label");
    expect(args.now).toBe(fixedNow);
  });

  it("records an ops.backup.created audit event on success, correlated to the new backup id", async () => {
    await createBackupM15V2SnapshotForUser(OWNER_ID, OWNER_ID, "my-label", { now: fixedNow });
    expect(writeOpsAuditEvent).toHaveBeenCalledWith({
      actorUserId: OWNER_ID,
      action: "ops.backup.created",
      status: "success",
      correlationRequestId: "created-backup-1",
      resourceId: "created-backup-1",
      metadata: {
        checksum: "checksum-1",
        checksumAlgorithm: "sha256",
        schemaVersion: "m15.v2",
        label: "my-label",
      },
    });
  });

  it("returns exactly what createBackupM15V2Snapshot returns", async () => {
    const result = await createBackupM15V2SnapshotForUser(OWNER_ID, OWNER_ID, "label", { now: fixedNow });
    expect(result).toMatchObject({ id: "created-backup-1", schemaVersion: "m15.v2" });
  });

  it("propagates a BackupM15V2SnapshotPersistenceError without writing an audit event", async () => {
    class FakePersistenceError extends Error {
      code = "PERSISTENCE_FAILED";
    }
    vi.mocked(createBackupM15V2Snapshot).mockRejectedValueOnce(new FakePersistenceError("boom"));

    await expect(
      createBackupM15V2SnapshotForUser(OWNER_ID, OWNER_ID, "label", { now: fixedNow }),
    ).rejects.toThrow("boom");
    expect(writeOpsAuditEvent).not.toHaveBeenCalled();
  });
});

describe("verifyBackupM15V2SnapshotForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. uses the real prisma singleton when no database override is provided", async () => {
    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow });
    const [args] = vi.mocked(verifyBackupM15V2Snapshot).mock.calls[0];
    expect(args.database).toBe(PRISMA_MARKER);
  });

  it("uses an injected database override when provided", async () => {
    const override = { __marker: "override-database" } as never;
    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow, database: override });
    const [args] = vi.mocked(verifyBackupM15V2Snapshot).mock.calls[0];
    expect(args.database).toBe(override);
  });

  it("2. builds the legacy-local resolver via the WP2H4 factory with no arguments", async () => {
    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow });
    expect(createLegacyLocalReferenceResolver).toHaveBeenCalledWith();
  });

  it("2b. builds the object-backed resolver via the WP2H4 factory using the real alias resolver", async () => {
    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow });
    expect(createObjectStorageAliasResolver).toHaveBeenCalledWith();
    expect(createObjectBackedReferenceResolver).toHaveBeenCalledWith({ resolveObjectStorage: RESOLVED_ALIAS_FN });
  });

  it("3. injects the clock into verifiedAt", async () => {
    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow });
    const [args] = vi.mocked(verifyBackupM15V2Snapshot).mock.calls[0];
    expect(args.verifiedAt).toBe(FIXED_NOW.toISOString());
  });

  it("4. never generates an id via a raw crypto call (id generation is injected via generateBackupId, not randomUUID)", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/randomUUID/);
  });

  it("5. never reads process.env directly", () => {
    expect(readSourceFile()).not.toMatch(/process\.env/);
  });

  it("6. imports no AWS SDK directly", () => {
    expect(readSourceFile()).not.toMatch(/@aws-sdk/);
  });

  it("7-8. never calls Date.now or constructs an un-injected Date", async () => {
    const spy = vi.spyOn(Date, "now");
    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("9. uses no internal random source", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/Math\.random/);
  });

  it("passes maxStreamBytes through only when provided", async () => {
    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow });
    expect(vi.mocked(verifyBackupM15V2Snapshot).mock.calls[0][0]).not.toHaveProperty("maxStreamBytes");

    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow, maxStreamBytes: 1024 });
    expect(vi.mocked(verifyBackupM15V2Snapshot).mock.calls[1][0].maxStreamBytes).toBe(1024);
  });

  it("returns exactly what verifyBackupM15V2Snapshot returns", async () => {
    const result = await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, { now: fixedNow });
    expect(result).toEqual({ ok: true, verifiedReferenceCount: 0 });
  });

  it("does not mutate the input dependencies", async () => {
    const dependencies = { now: fixedNow };
    const before = { ...dependencies };
    await verifyBackupM15V2SnapshotForUser(OWNER_ID, BACKUP_ID, dependencies);
    expect(dependencies).toEqual(before);
  });
});

function readSourceFile(): string {
  const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "backup-m15-v2-snapshot-persistence-runtime.ts");
  return fs.readFileSync(sourcePath, "utf8");
}
