import { createHash } from "crypto";

import {
  canonicalizeM15SortedJson,
  computeBackupM15V1Checksum,
  parseBackupM15V1Artifact,
} from "./backup-m15-artifact";
import type {
  BackupM15RestorePreviewExternalReferenceCode,
  BackupM15RestorePreviewResponse,
  BackupM15V1Artifact,
  BackupRestorePreviewImpactSection,
  BackupRestorePreviewIssue,
  BackupRestorePreviewSection,
} from "./contracts";
import type {
  M15ExternalReferenceVerificationResult,
  M15ObjectStorageAliasResolver,
  VerifyM15ExternalReferencesInput,
} from "./backup-m15-external-reference-verifier";

const M15_PREVIEW_FINGERPRINT_CONTRACT_VERSION = "m15.restore-preview.v1" as const;
const SECTIONS: BackupRestorePreviewSection[] = [
  "clients",
  "analyses",
  "consultations",
  "imageAssets",
  "imageAnalyses",
  "imageAnalysisReviews",
];

type M15Sections = BackupM15V1Artifact["sections"];
type SectionRows = M15Sections[BackupRestorePreviewSection];
type SectionRow = SectionRows[number];

export interface BackupM15RestorePreviewSource {
  ownerUserId: string;
  backupId: string;
  backupChecksum: string;
  artifact: unknown;
  currentState: M15Sections;
}

export type BackupM15ExternalReferenceVerifier = (
  input: VerifyM15ExternalReferencesInput,
) => Promise<M15ExternalReferenceVerificationResult>;

export interface BackupM15RestorePreviewDependencies {
  verifyExternalReferences: BackupM15ExternalReferenceVerifier;
  resolveStorage: M15ObjectStorageAliasResolver;
  now?: () => Date;
  maxStreamBytes?: number;
}

interface NormalizedState {
  contractVersion: typeof M15_PREVIEW_FINGERPRINT_CONTRACT_VERSION;
  ownerUserId: string;
  sections: M15Sections;
}

export async function buildBackupM15RestorePreview(
  source: BackupM15RestorePreviewSource,
  dependencies: BackupM15RestorePreviewDependencies,
): Promise<BackupM15RestorePreviewResponse> {
  const previewGeneratedAt = safeNow(dependencies.now).toISOString();
  const currentState = normalizeState(source.currentState, source.ownerUserId);
  const currentValidation = validateState(currentState.sections, source.ownerUserId, "current");
  let artifact: BackupM15V1Artifact;

  try {
    artifact = parseBackupM15V1Artifact(source.artifact);
  } catch {
    return buildInvalidArtifactPreview(source, currentState, previewGeneratedAt, currentValidation);
  }

  const backupState = normalizeState(artifact.sections, artifact.ownerUserId);
  const checksum = computeBackupM15V1Checksum(artifact);
  const checksumStatus = artifact.checksum === checksum && source.backupChecksum === checksum ? "valid" : "mismatch";
  const blockingReasons: BackupRestorePreviewIssue[] = [...currentValidation];

  if (artifact.backupId !== source.backupId) {
    blockingReasons.push(issue("ARTIFACT_INVALID", null, "Backup identity does not match the selected snapshot."));
  }
  if (artifact.ownerUserId !== source.ownerUserId) {
    blockingReasons.push(issue("OWNER_SCOPE_MISMATCH", null, "Backup owner scope does not match the requested owner."));
  }
  blockingReasons.push(...validateState(backupState.sections, source.ownerUserId, "backup"));
  if (checksumStatus === "mismatch") {
    blockingReasons.push(issue("CHECKSUM_MISMATCH", null, "Backup checksum does not match canonical content."));
  }

  const artifactValid = blockingReasons.length === 0;
  const verification = artifactValid
    ? await runVerifier(artifact, dependencies)
    : failedVerification("invalid_reference");
  if (verification.status === "failed") {
    blockingReasons.push(externalReferenceIssue(verification.code));
  }

  const comparison = compareStates(backupState.sections, currentState.sections);
  const conflicts = [...comparison.conflicts];
  const latestBackupUpdatedAt = latestTimestamp(backupState.sections);
  const latestCurrentUpdatedAt = latestTimestamp(currentState.sections);
  const warnings: BackupRestorePreviewIssue[] = [];
  if (compareNullableTimestamps(latestBackupUpdatedAt, latestCurrentUpdatedAt) < 0) {
    warnings.push(issue("BACKUP_OLDER_THAN_CURRENT_STATE", null, "Current state is newer than the backup snapshot."));
  }

  const backupStateFingerprint = hash(backupState);
  const currentStateFingerprint = hash(currentState);
  const currentClientStateFingerprint = hash({
    contractVersion: M15_PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    ownerUserId: source.ownerUserId,
    clients: currentState.sections.clients,
  });
  const eligibleForRestorePlanning = artifactValid && verification.status === "verified";
  const externalReferences = sanitizeVerification(verification);
  const previewFingerprint = hash({
    contractVersion: M15_PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    backupId: source.backupId,
    backupStateFingerprint,
    currentStateFingerprint,
    currentClientStateFingerprint,
    eligibleForRestorePlanning,
    checksumStatus,
    artifactValidity: artifactValid ? "valid" : "invalid",
    externalReferences,
    impact: comparison.impact,
    conflicts,
    warnings,
    blockingReasons,
  });

  return {
    backupId: source.backupId,
    schemaVersion: "m15.v1",
    eligibleForRestorePlanning,
    checksumStatus,
    artifactValidity: artifactValid ? "valid" : "invalid",
    externalReferenceStatus: externalReferences.status,
    externalReferences,
    backupStateFingerprint,
    currentStateFingerprint,
    currentClientStateFingerprint,
    previewGeneratedAt,
    previewFingerprint,
    latestBackupUpdatedAt,
    latestCurrentUpdatedAt,
    impact: comparison.impact,
    conflicts,
    warnings,
    blockingReasons,
  };
}

function buildInvalidArtifactPreview(
  source: BackupM15RestorePreviewSource,
  currentState: NormalizedState,
  previewGeneratedAt: string,
  currentValidation: BackupRestorePreviewIssue[],
): BackupM15RestorePreviewResponse {
  const blockingReasons = [
    ...currentValidation,
    issue("ARTIFACT_INVALID", null, "Backup artifact is not a valid m15.v1 artifact."),
  ];
  const impact = emptyBackupImpact(currentState.sections);
  const externalReferences = sanitizeVerification(failedVerification("invalid_reference"));
  const backupStateFingerprint = hash({
    contractVersion: M15_PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    backupId: source.backupId,
    artifactValidity: "invalid",
  });
  const currentStateFingerprint = hash(currentState);
  const currentClientStateFingerprint = hash({
    contractVersion: M15_PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    ownerUserId: source.ownerUserId,
    clients: currentState.sections.clients,
  });
  const previewFingerprint = hash({
    contractVersion: M15_PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    backupId: source.backupId,
    backupStateFingerprint,
    currentStateFingerprint,
    currentClientStateFingerprint,
    eligibleForRestorePlanning: false,
    checksumStatus: "unavailable",
    artifactValidity: "invalid",
    externalReferences,
    impact,
    blockingReasons,
  });

  return {
    backupId: source.backupId,
    schemaVersion: "m15.v1",
    eligibleForRestorePlanning: false,
    checksumStatus: "unavailable",
    artifactValidity: "invalid",
    externalReferenceStatus: "failed",
    externalReferences,
    backupStateFingerprint,
    currentStateFingerprint,
    currentClientStateFingerprint,
    previewGeneratedAt,
    previewFingerprint,
    latestBackupUpdatedAt: null,
    latestCurrentUpdatedAt: latestTimestamp(currentState.sections),
    impact,
    conflicts: [],
    warnings: [],
    blockingReasons,
  };
}

async function runVerifier(
  artifact: BackupM15V1Artifact,
  dependencies: BackupM15RestorePreviewDependencies,
): Promise<M15ExternalReferenceVerificationResult> {
  try {
    return await dependencies.verifyExternalReferences({
      artifact,
      resolveStorage: dependencies.resolveStorage,
      ...(dependencies.maxStreamBytes === undefined ? {} : { maxStreamBytes: dependencies.maxStreamBytes }),
      now: dependencies.now,
    });
  } catch {
    return failedVerification("storage_unavailable");
  }
}

function failedVerification(
  code: Exclude<BackupM15RestorePreviewExternalReferenceCode, "verified">,
): M15ExternalReferenceVerificationResult {
  return {
    status: "failed",
    code,
    verifiedAt: "",
    totalReferences: 0,
    verifiedReferences: 0,
    referenceIndex: null,
    assetId: null,
  };
}

function sanitizeVerification(
  verification: M15ExternalReferenceVerificationResult,
): BackupM15RestorePreviewResponse["externalReferences"] {
  return {
    status: verification.status,
    code: verification.code,
    totalReferences: verification.totalReferences,
    verifiedReferences: verification.verifiedReferences,
  };
}

function externalReferenceIssue(
  code: Exclude<BackupM15RestorePreviewExternalReferenceCode, "verified">,
): BackupRestorePreviewIssue {
  const messages: Record<typeof code, string> = {
    invalid_reference: "Object reference contract is invalid.",
    unknown_alias: "Object storage alias is unavailable.",
    missing_object: "A referenced object is unavailable.",
    identity_mismatch: "Referenced object identity verification failed.",
    version_mismatch: "Referenced object version verification failed.",
    size_mismatch: "Referenced object metadata size verification failed.",
    checksum_metadata_mismatch: "Referenced object metadata checksum verification failed.",
    streamed_checksum_mismatch: "Referenced object content checksum verification failed.",
    streamed_size_mismatch: "Referenced object content size verification failed.",
    stream_limit_exceeded: "Referenced object exceeds the approved verification limit.",
    storage_timeout: "Object storage verification timed out.",
    storage_access_denied: "Object storage verification was denied.",
    storage_unavailable: "Object storage verification is unavailable.",
  };
  return issue("ARTIFACT_INVALID", "imageAssets", messages[code]);
}

function normalizeState(sections: M15Sections, ownerUserId: string): NormalizedState {
  return {
    contractVersion: M15_PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    ownerUserId,
    sections: {
      clients: sortRows(sections.clients),
      analyses: sortRows(sections.analyses),
      consultations: sortRows(sections.consultations),
      imageAssets: sortRows(sections.imageAssets),
      imageAnalyses: sortRows(sections.imageAnalyses),
      imageAnalysisReviews: sortRows(sections.imageAnalysisReviews),
    },
  };
}

function validateState(
  sections: M15Sections,
  ownerUserId: string,
  scope: "backup" | "current",
): BackupRestorePreviewIssue[] {
  const issues: BackupRestorePreviewIssue[] = [];
  const clients = new Map(sections.clients.map((row) => [row.id, row]));
  const analyses = new Map(sections.analyses.map((row) => [row.id, row]));
  const assets = new Map(sections.imageAssets.map((row) => [row.id, row]));
  const imageAnalyses = new Map(sections.imageAnalyses.map((row) => [row.id, row]));
  const ownershipInvalid = [
    ...sections.clients,
    ...sections.analyses,
    ...sections.consultations,
    ...sections.imageAssets,
  ].some((row) => row.ownerUserId !== ownerUserId);

  if (ownershipInvalid) {
    issues.push(issue("OWNER_SCOPE_MISMATCH", null, `${capitalize(scope)} state contains a row outside the owner scope.`));
  }

  const graphInvalid =
    sections.analyses.some((row) =>
      !clients.has(row.clientId) ||
      (row.imageAssetId !== null && !assets.has(row.imageAssetId)) ||
      (row.imageAnalysisId !== null && !imageAnalyses.has(row.imageAnalysisId))) ||
    sections.consultations.some((row) => {
      const analysis = analyses.get(row.analysisId);
      return !clients.has(row.clientId) || !analysis || analysis.clientId !== row.clientId || analysis.ownerUserId !== row.ownerUserId;
    }) ||
    sections.imageAssets.some((row) => !clients.has(row.clientId)) ||
    sections.imageAnalyses.some((row) => !assets.has(row.assetId)) ||
    sections.imageAnalysisReviews.some((row) => !imageAnalyses.has(row.analysisId));

  if (graphInvalid) {
    issues.push(issue("REFERENCE_GRAPH_INVALID", null, `${capitalize(scope)} reference graph is invalid.`));
  }
  return issues;
}

function compareStates(backup: M15Sections, current: M15Sections): {
  impact: BackupM15RestorePreviewResponse["impact"];
  conflicts: BackupRestorePreviewIssue[];
} {
  const impact = {} as BackupM15RestorePreviewResponse["impact"];
  const conflicts: BackupRestorePreviewIssue[] = [];
  for (const section of SECTIONS) {
    const sectionImpact = compareSection(backup[section] as SectionRow[], current[section] as SectionRow[]);
    impact[section] = sectionImpact;
    if (sectionImpact.wouldDelete > 0) {
      conflicts.push(issue("CURRENT_STATE_HAS_EXTRA_ROWS", section, "Current state contains rows absent from the backup."));
    }
  }
  return { impact, conflicts };
}

function compareSection(backupRows: SectionRow[], currentRows: SectionRow[]): BackupRestorePreviewImpactSection {
  const backup = new Map(backupRows.map((row) => [row.id, row]));
  const current = new Map(currentRows.map((row) => [row.id, row]));
  let wouldCreate = 0;
  let wouldReplace = 0;
  let unchanged = 0;

  for (const row of backupRows) {
    const currentRow = current.get(row.id);
    if (!currentRow) {
      wouldCreate += 1;
    } else if (canonicalizeM15SortedJson(row) === canonicalizeM15SortedJson(currentRow)) {
      unchanged += 1;
    } else {
      wouldReplace += 1;
    }
  }
  const wouldDelete = currentRows.filter((row) => !backup.has(row.id)).length;
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

function emptyBackupImpact(current: M15Sections): BackupM15RestorePreviewResponse["impact"] {
  const impact = {} as BackupM15RestorePreviewResponse["impact"];
  for (const section of SECTIONS) {
    impact[section] = {
      backupCount: 0,
      currentCount: current[section].length,
      wouldCreate: 0,
      wouldReplace: 0,
      wouldDelete: current[section].length,
      unchanged: 0,
      conflictCount: 0,
    };
  }
  return impact;
}

function latestTimestamp(sections: M15Sections): string | null {
  const timestamps = [
    ...sections.clients.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...sections.analyses.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...sections.consultations.map((row) => row.createdAt),
    ...sections.imageAssets.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...sections.imageAnalyses.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...sections.imageAnalysisReviews.flatMap((row) => [row.createdAt, row.updatedAt]),
  ].sort();
  return timestamps.at(-1) ?? null;
}

function compareNullableTimestamps(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left.localeCompare(right);
}

function sortRows<T extends { id: string }>(rows: T[]): T[] {
  return structuredClone(rows).sort((left, right) => left.id.localeCompare(right.id));
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalizeM15SortedJson(value), "utf8").digest("hex");
}

function issue(
  code: BackupRestorePreviewIssue["code"],
  section: BackupRestorePreviewSection | null,
  messageSafe: string,
): BackupRestorePreviewIssue {
  return { code, section, recordId: null, referenceId: null, messageSafe };
}

function safeNow(clock: (() => Date) | undefined): Date {
  try {
    const value = (clock ?? (() => new Date()))();
    if (Number.isFinite(value.getTime())) return value;
  } catch {
  }
  return new Date(0);
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
