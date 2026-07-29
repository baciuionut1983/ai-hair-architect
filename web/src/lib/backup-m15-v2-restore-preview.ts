import { createHash } from "crypto";

import {
  canonicalizeM15V2,
  parseBackupM15V2Artifact,
} from "./backup-m15-v2-artifact";
import {
  verifyBackupM15V2ExternalReferences,
  type BackupM15V2LegacyLocalReferenceResolver,
  type BackupM15V2ObjectBackedReferenceResolver,
} from "./backup-m15-v2-external-reference-verifier";

export const M15_V2_RESTORE_PREVIEW_VERSION = "m15.restore-preview.v2" as const;

const SECTION_NAMES = [
  "clients",
  "analyses",
  "consultations",
  "imageAssets",
  "imageAnalyses",
  "imageAnalysisReviews",
] as const;

const OWNER_SCOPED_SECTIONS = new Set<(typeof SECTION_NAMES)[number]>([
  "clients",
  "analyses",
  "consultations",
  "imageAssets",
]);

// Derived structurally from the WP2H1 parser's return type so this module never imports
// from ./contracts and never re-declares the m15.v2 schema.
type BackupM15V2ArtifactShape = ReturnType<typeof parseBackupM15V2Artifact>;
type BackupM15V2SectionsShape = BackupM15V2ArtifactShape["sections"];
type BackupM15V2SectionName = (typeof SECTION_NAMES)[number];

export type BackupM15V2RestorePreviewCurrentState = BackupM15V2SectionsShape;

export type BackupM15V2RestorePreviewSectionName = BackupM15V2SectionName;

export interface BackupM15V2RestorePreviewSectionImpact {
  readonly backupCount: number;
  readonly currentCount: number;
  readonly wouldCreate: number;
  readonly wouldReplace: number;
  readonly wouldDelete: number;
  readonly unchanged: number;
  readonly conflictCount: number;
}

export interface BackupM15V2RestorePreviewSummary {
  readonly totalBackupRows: number;
  readonly totalCurrentRows: number;
  readonly totalWouldCreate: number;
  readonly totalWouldReplace: number;
  readonly totalWouldDelete: number;
  readonly totalUnchanged: number;
}

export type BackupM15V2RestorePreviewBlockingReasonCode = "CURRENT_STATE_HAS_EXTRA_ROWS";

export interface BackupM15V2RestorePreviewBlockingReason {
  readonly code: BackupM15V2RestorePreviewBlockingReasonCode;
  readonly section: BackupM15V2RestorePreviewSectionName;
  readonly message: string;
}

export type BackupM15V2RestorePreviewWarningCode = "STALE_BACKUP";

export interface BackupM15V2RestorePreviewWarning {
  readonly code: BackupM15V2RestorePreviewWarningCode;
  readonly message: string;
}

export type BackupM15V2RestorePreviewFailureCode =
  | "invalid_artifact"
  | "invalid_current_state"
  | "conflict_detected"
  | "external_reference_verification_failed"
  | "fingerprint_generation_failed"
  | "internal_contract_violation";

const SAFE_FAILURE_MESSAGES: Record<BackupM15V2RestorePreviewFailureCode, string> = {
  invalid_artifact: "The backup artifact is not a valid, identity-matched m15.v2 artifact.",
  invalid_current_state: "The supplied current state is not structurally valid for comparison.",
  conflict_detected: "The backup or current state reference graph is internally inconsistent.",
  external_reference_verification_failed: "External reference verification did not succeed.",
  fingerprint_generation_failed: "The preview fingerprint could not be generated.",
  internal_contract_violation: "A dependency violated its contract during preview generation.",
};

export interface BackupM15V2RestorePreviewSuccess {
  readonly ok: true;
  readonly artifactVersion: "m15.v2";
  readonly previewVersion: typeof M15_V2_RESTORE_PREVIEW_VERSION;
  readonly backupId: string;
  readonly previewedAt: string;
  readonly fingerprint: string;
  readonly canRestore: boolean;
  readonly blockingReasons: readonly BackupM15V2RestorePreviewBlockingReason[];
  readonly warnings: readonly BackupM15V2RestorePreviewWarning[];
  readonly sectionImpacts: Readonly<Record<BackupM15V2RestorePreviewSectionName, BackupM15V2RestorePreviewSectionImpact>>;
  readonly summary: BackupM15V2RestorePreviewSummary;
  readonly verifiedExternalReferenceCount: number;
}

export interface BackupM15V2RestorePreviewFailure {
  readonly ok: false;
  readonly code: BackupM15V2RestorePreviewFailureCode;
  readonly message: string;
  readonly previewVersion: typeof M15_V2_RESTORE_PREVIEW_VERSION;
  readonly previewedAt: string;
}

export type BackupM15V2RestorePreviewResult =
  | BackupM15V2RestorePreviewSuccess
  | BackupM15V2RestorePreviewFailure;

export interface BackupM15V2RestorePreviewInput {
  readonly artifact: unknown;
  readonly backupId: string;
  readonly ownerUserId: string;
  readonly currentState: unknown;
  readonly previewedAt: string;
  readonly legacyLocalResolver: BackupM15V2LegacyLocalReferenceResolver;
  readonly objectBackedResolver: BackupM15V2ObjectBackedReferenceResolver;
  readonly verifyExternalReferences: typeof verifyBackupM15V2ExternalReferences;
  readonly maxStreamBytes?: number;
}

export async function buildBackupM15V2RestorePreview(
  input: BackupM15V2RestorePreviewInput,
): Promise<BackupM15V2RestorePreviewResult> {
  const previewedAt = input.previewedAt;
  if (
    typeof previewedAt !== "string" ||
    !previewedAt ||
    typeof input.backupId !== "string" ||
    !input.backupId ||
    typeof input.ownerUserId !== "string" ||
    !input.ownerUserId
  ) {
    return failure("invalid_artifact", typeof previewedAt === "string" ? previewedAt : "");
  }

  let artifact: BackupM15V2ArtifactShape;
  try {
    artifact = parseBackupM15V2Artifact(input.artifact);
  } catch {
    return failure("invalid_artifact", previewedAt);
  }
  if (artifact.backupId !== input.backupId || artifact.ownerUserId !== input.ownerUserId) {
    return failure("invalid_artifact", previewedAt);
  }

  if (!validateCurrentState(input.currentState, input.ownerUserId)) {
    return failure("invalid_current_state", previewedAt);
  }
  // Validated above: every section is a well-formed, id-unique, owner-scoped array.
  const currentState = input.currentState as BackupM15V2RestorePreviewCurrentState;

  if (!isReferenceGraphValid(artifact.sections) || !isReferenceGraphValid(currentState)) {
    return failure("conflict_detected", previewedAt);
  }

  let verification;
  try {
    verification = await input.verifyExternalReferences({
      artifact,
      verifiedAt: previewedAt,
      legacyLocalResolver: input.legacyLocalResolver,
      objectBackedResolver: input.objectBackedResolver,
      ...(input.maxStreamBytes === undefined ? {} : { maxStreamBytes: input.maxStreamBytes }),
    });
  } catch {
    return failure("internal_contract_violation", previewedAt);
  }
  if (!verification.ok) {
    return failure("external_reference_verification_failed", previewedAt);
  }

  const sectionImpacts = {} as Record<BackupM15V2RestorePreviewSectionName, BackupM15V2RestorePreviewSectionImpact>;
  const blockingReasons: BackupM15V2RestorePreviewBlockingReason[] = [];
  for (const section of SECTION_NAMES) {
    const impact = compareSection(artifact.sections[section], currentState[section]);
    sectionImpacts[section] = impact;
    if (impact.wouldDelete > 0) {
      blockingReasons.push({
        code: "CURRENT_STATE_HAS_EXTRA_ROWS",
        section,
        message: "Current state contains rows absent from the backup.",
      });
    }
  }

  const warnings: BackupM15V2RestorePreviewWarning[] = [];
  const latestBackupTimestamp = latestTimestamp(artifact.sections);
  const latestCurrentTimestamp = latestTimestamp(currentState);
  if (compareNullableLexical(latestBackupTimestamp, latestCurrentTimestamp) < 0) {
    warnings.push({ code: "STALE_BACKUP", message: "Current state is newer than the backup snapshot." });
  }

  const summary = summarize(sectionImpacts);
  const canRestore = blockingReasons.length === 0;

  let fingerprint: string;
  try {
    fingerprint = computeFingerprint({
      previewVersion: M15_V2_RESTORE_PREVIEW_VERSION,
      backupId: input.backupId,
      ownerUserId: input.ownerUserId,
      artifactVersion: "m15.v2",
      canRestore,
      blockingReasons,
      warnings,
      sectionImpacts,
      summary,
      verifiedExternalReferenceCount: verification.verifiedReferenceCount,
    });
  } catch {
    return failure("fingerprint_generation_failed", previewedAt);
  }

  return {
    ok: true,
    artifactVersion: "m15.v2",
    previewVersion: M15_V2_RESTORE_PREVIEW_VERSION,
    backupId: input.backupId,
    previewedAt,
    fingerprint,
    canRestore,
    blockingReasons,
    warnings,
    sectionImpacts,
    summary,
    verifiedExternalReferenceCount: verification.verifiedReferenceCount,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateCurrentState(candidate: unknown, ownerUserId: string): boolean {
  if (!isPlainObject(candidate)) return false;
  const keys = Object.keys(candidate);
  if (
    keys.length !== SECTION_NAMES.length ||
    SECTION_NAMES.some((name) => !Object.prototype.hasOwnProperty.call(candidate, name))
  ) {
    return false;
  }

  for (const name of SECTION_NAMES) {
    const rows = candidate[name];
    if (!Array.isArray(rows)) return false;
    const seenIds = new Set<string>();
    for (const row of rows) {
      if (!isPlainObject(row)) return false;
      if (typeof row.id !== "string" || row.id.length === 0) return false;
      if (seenIds.has(row.id)) return false;
      seenIds.add(row.id);
      if (OWNER_SCOPED_SECTIONS.has(name) && row.ownerUserId !== ownerUserId) return false;
    }
  }
  return true;
}

function isReferenceGraphValid(sections: BackupM15V2SectionsShape): boolean {
  const clients = new Set(sections.clients.map((row) => row.id));
  const analysesById = new Map(sections.analyses.map((row) => [row.id, row]));
  const assets = new Set(sections.imageAssets.map((row) => row.id));
  const imageAnalyses = new Set(sections.imageAnalyses.map((row) => row.id));

  for (const row of sections.analyses) {
    if (!clients.has(row.clientId)) return false;
    if (row.imageAssetId !== null && !assets.has(row.imageAssetId)) return false;
    if (row.imageAnalysisId !== null && !imageAnalyses.has(row.imageAnalysisId)) return false;
  }
  for (const row of sections.consultations) {
    const analysis = analysesById.get(row.analysisId);
    if (!clients.has(row.clientId)) return false;
    if (!analysis) return false;
    if (analysis.clientId !== row.clientId) return false;
    if (analysis.ownerUserId !== row.ownerUserId) return false;
  }
  for (const row of sections.imageAssets) {
    if (!clients.has(row.clientId)) return false;
  }
  for (const row of sections.imageAnalyses) {
    if (!assets.has(row.assetId)) return false;
  }
  for (const row of sections.imageAnalysisReviews) {
    if (!imageAnalyses.has(row.analysisId)) return false;
  }
  return true;
}

function compareSection(
  backupRows: readonly { id: string }[],
  currentRows: readonly { id: string }[],
): BackupM15V2RestorePreviewSectionImpact {
  const backupById = new Map(backupRows.map((row) => [row.id, row]));
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const sortedBackupIds = backupRows.map((row) => row.id).sort(compareLexical);

  let wouldCreate = 0;
  let wouldReplace = 0;
  let unchanged = 0;
  for (const id of sortedBackupIds) {
    const backupRow = backupById.get(id);
    const currentRow = currentById.get(id);
    if (!currentRow) {
      wouldCreate += 1;
    } else if (canonicalizeM15V2(backupRow) === canonicalizeM15V2(currentRow)) {
      unchanged += 1;
    } else {
      wouldReplace += 1;
    }
  }
  const wouldDelete = currentRows.filter((row) => !backupById.has(row.id)).length;

  return {
    backupCount: backupRows.length,
    currentCount: currentRows.length,
    wouldCreate,
    wouldReplace,
    wouldDelete,
    unchanged,
    conflictCount: wouldDelete > 0 ? 1 : 0,
  };
}

function summarize(
  sectionImpacts: Record<BackupM15V2RestorePreviewSectionName, BackupM15V2RestorePreviewSectionImpact>,
): BackupM15V2RestorePreviewSummary {
  let totalBackupRows = 0;
  let totalCurrentRows = 0;
  let totalWouldCreate = 0;
  let totalWouldReplace = 0;
  let totalWouldDelete = 0;
  let totalUnchanged = 0;
  for (const section of SECTION_NAMES) {
    const impact = sectionImpacts[section];
    totalBackupRows += impact.backupCount;
    totalCurrentRows += impact.currentCount;
    totalWouldCreate += impact.wouldCreate;
    totalWouldReplace += impact.wouldReplace;
    totalWouldDelete += impact.wouldDelete;
    totalUnchanged += impact.unchanged;
  }
  return { totalBackupRows, totalCurrentRows, totalWouldCreate, totalWouldReplace, totalWouldDelete, totalUnchanged };
}

function latestTimestamp(sections: BackupM15V2SectionsShape): string | null {
  const timestamps: string[] = [
    ...sections.clients.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...sections.analyses.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...sections.consultations.map((row) => row.createdAt),
    ...sections.imageAssets.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...sections.imageAnalyses.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...sections.imageAnalysisReviews.flatMap((row) => [row.createdAt, row.updatedAt]),
  ];
  if (timestamps.length === 0) return null;
  return timestamps.slice().sort(compareLexical).at(-1) ?? null;
}

function compareLexical(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNullableLexical(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareLexical(left, right);
}

function computeFingerprint(payload: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalizeM15V2(payload), "utf8").digest("hex");
}

function failure(code: BackupM15V2RestorePreviewFailureCode, previewedAt: string): BackupM15V2RestorePreviewFailure {
  return {
    ok: false,
    code,
    message: SAFE_FAILURE_MESSAGES[code],
    previewVersion: M15_V2_RESTORE_PREVIEW_VERSION,
    previewedAt,
  };
}
