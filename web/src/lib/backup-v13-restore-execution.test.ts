import { describe, expect, it } from "vitest";

import { executeBackupRestoreForUser, __testUtils } from "@/lib/backup-v13-restore-execution";

describe("backup-v13-restore-execution", () => {
  it("exposes resettable test hooks", () => {
    __testUtils.setForcePostconditionMismatch(true);
    __testUtils.setRetryableFailuresRemaining(2);
    __testUtils.resetHooks();

    expect(typeof executeBackupRestoreForUser).toBe("function");
  });
});