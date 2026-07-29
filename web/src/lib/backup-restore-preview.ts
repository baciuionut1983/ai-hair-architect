export type BackupRestorePreviewBuilder<TSource, TResult> = (
  source: TSource,
) => TResult | Promise<TResult>;

export interface BackupRestorePreviewDispatchInput<TM13Source, TM15Source> {
  artifact: unknown;
  m13Source: TM13Source;
  m15Source: TM15Source;
}

export interface BackupRestorePreviewDispatchDependencies<
  TM13Source,
  TM15Source,
  TM13Result,
  TM15Result,
> {
  buildM13Preview: BackupRestorePreviewBuilder<TM13Source, TM13Result>;
  buildM15Preview: BackupRestorePreviewBuilder<TM15Source, TM15Result>;
}

export class BackupRestorePreviewDispatchError extends Error {
  readonly code = "BACKUP_PREVIEW_UNSUPPORTED_SCHEMA";

  constructor() {
    super("Backup schema is not supported for restore preview.");
    this.name = "BackupRestorePreviewDispatchError";
  }
}

export async function dispatchBackupRestorePreview<
  TM13Source,
  TM15Source,
  TM13Result,
  TM15Result,
>(
  input: BackupRestorePreviewDispatchInput<TM13Source, TM15Source>,
  dependencies: BackupRestorePreviewDispatchDependencies<TM13Source, TM15Source, TM13Result, TM15Result>,
): Promise<TM13Result | TM15Result> {
  const schemaVersion = readSchemaVersion(input.artifact);

  switch (schemaVersion) {
    case "m13.v1":
    case "m13.v2":
    case "m13.v3":
      return dependencies.buildM13Preview(input.m13Source);
    case "m15.v1":
      return dependencies.buildM15Preview(input.m15Source);
    default:
      throw new BackupRestorePreviewDispatchError();
  }
}

function readSchemaVersion(artifact: unknown): string | null {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return null;
  }
  const schemaVersion = (artifact as Record<string, unknown>).schemaVersion;
  return typeof schemaVersion === "string" ? schemaVersion : null;
}
