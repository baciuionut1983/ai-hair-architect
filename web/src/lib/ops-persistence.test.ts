import { describe, expect, it } from "vitest";

import { __testUtils } from "@/lib/ops-persistence";

describe("M12 ops persistence utilities", () => {
  it("produces stable backup checksum for the same logical snapshot", () => {
    const snapshot = {
      clientsCount: 2,
      consultationsCount: 4,
      appointmentsCount: 1,
      notificationsCount: 3,
      workspacesCount: 1,
    };

    const first = __testUtils.computeBackupChecksum("user-1", snapshot);
    const second = __testUtils.computeBackupChecksum("user-1", { ...snapshot });

    expect(first).toBe(second);
  });

  it("changes checksum when snapshot content changes even if some counters overlap", () => {
    const first = __testUtils.computeBackupChecksum("user-1", {
      clientsCount: 2,
      consultationsCount: 4,
      appointmentsCount: 1,
      notificationsCount: 3,
      workspacesCount: 1,
    });

    const second = __testUtils.computeBackupChecksum("user-1", {
      clientsCount: 2,
      consultationsCount: 5,
      appointmentsCount: 1,
      notificationsCount: 3,
      workspacesCount: 1,
    });

    expect(first).not.toBe(second);
  });

  it("normalizes retention fingerprint whitespace but preserves semantic casing", () => {
    const first = __testUtils.computeRetentionFingerprint({
      ownerUserId: "user-1",
      olderThanDays: 90,
      reason: " Keep   Case ",
    });

    const second = __testUtils.computeRetentionFingerprint({
      ownerUserId: "user-1",
      olderThanDays: 90,
      reason: "Keep Case",
    });

    const third = __testUtils.computeRetentionFingerprint({
      ownerUserId: "user-1",
      olderThanDays: 90,
      reason: "keep case",
    });

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("derives a stable advisory lock key per owner scope", () => {
    expect(__testUtils.deriveAdvisoryLockKey("user-1")).toBe(__testUtils.deriveAdvisoryLockKey("user-1"));
    expect(__testUtils.deriveAdvisoryLockKey("user-1")).not.toBe(__testUtils.deriveAdvisoryLockKey("user-2"));
  });
});