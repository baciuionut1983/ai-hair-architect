import { describe, expect, it, vi } from "vitest";

import {
  BackupRestorePreviewDispatchError,
  dispatchBackupRestorePreview,
} from "./backup-restore-preview";

function setup(schemaVersion: unknown) {
  const buildM13Preview = vi.fn(async (source: { kind: string }) => ({ branch: "m13", source }));
  const buildM15Preview = vi.fn(async (source: { kind: string }) => ({ branch: "m15", source }));
  const input = {
    artifact: { schemaVersion },
    m13Source: { kind: "m13-source" },
    m15Source: { kind: "m15-source" },
  };
  return { input, buildM13Preview, buildM15Preview };
}

describe("backup restore preview dispatcher", () => {
  it.each(["m13.v1", "m13.v2", "m13.v3"])("delegates %s to the injected M13 builder", async (schemaVersion) => {
    const fixture = setup(schemaVersion);

    await expect(dispatchBackupRestorePreview(fixture.input, fixture)).resolves.toEqual({
      branch: "m13",
      source: fixture.input.m13Source,
    });
    expect(fixture.buildM13Preview).toHaveBeenCalledOnce();
    expect(fixture.buildM13Preview).toHaveBeenCalledWith(fixture.input.m13Source);
    expect(fixture.buildM15Preview).not.toHaveBeenCalled();
  });

  it("delegates m15.v1 only to the injected M15 builder", async () => {
    const fixture = setup("m15.v1");

    await expect(dispatchBackupRestorePreview(fixture.input, fixture)).resolves.toEqual({
      branch: "m15",
      source: fixture.input.m15Source,
    });
    expect(fixture.buildM15Preview).toHaveBeenCalledOnce();
    expect(fixture.buildM15Preview).toHaveBeenCalledWith(fixture.input.m15Source);
    expect(fixture.buildM13Preview).not.toHaveBeenCalled();
  });

  it.each([
    { schemaVersion: "m16.v1" },
    { schemaVersion: null },
    { schemaVersion: undefined },
  ])("rejects an unsupported schema without calling either builder", async ({ schemaVersion }) => {
    const fixture = setup(schemaVersion);

    await expect(dispatchBackupRestorePreview(fixture.input, fixture)).rejects.toMatchObject({
      code: "BACKUP_PREVIEW_UNSUPPORTED_SCHEMA",
    });
    expect(fixture.buildM13Preview).not.toHaveBeenCalled();
    expect(fixture.buildM15Preview).not.toHaveBeenCalled();
  });

  it("rejects malformed artifacts without fallback", async () => {
    const fixture = setup("m13.v1");
    fixture.input.artifact = null as never;

    await expect(dispatchBackupRestorePreview(fixture.input, fixture)).rejects.toBeInstanceOf(
      BackupRestorePreviewDispatchError,
    );
    expect(fixture.buildM13Preview).not.toHaveBeenCalled();
    expect(fixture.buildM15Preview).not.toHaveBeenCalled();
  });

  it("does not fall back to M15 when the selected M13 builder fails", async () => {
    const fixture = setup("m13.v3");
    fixture.buildM13Preview.mockRejectedValueOnce(new Error("m13-failed"));

    await expect(dispatchBackupRestorePreview(fixture.input, fixture)).rejects.toThrow("m13-failed");
    expect(fixture.buildM15Preview).not.toHaveBeenCalled();
  });

  it("does not fall back to M13 when the selected M15 builder fails", async () => {
    const fixture = setup("m15.v1");
    fixture.buildM15Preview.mockRejectedValueOnce(new Error("m15-failed"));

    await expect(dispatchBackupRestorePreview(fixture.input, fixture)).rejects.toThrow("m15-failed");
    expect(fixture.buildM13Preview).not.toHaveBeenCalled();
  });
});
