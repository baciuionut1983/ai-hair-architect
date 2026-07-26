import { randomUUID } from "crypto";

import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  BACKUP_V13_V3_SCHEMA_VERSION,
  BACKUP_V13_V2_SCHEMA_VERSION,
  computeArtifactChecksumHex,
  isBackupV13V3Artifact,
} from "@/lib/backup-v13-artifact";
import { executeBackupRestoreForUser, __testUtils as restoreTestUtils } from "@/lib/backup-v13-restore-execution";
import { getBackupRestorePreviewForUser } from "@/lib/backup-v13-restore-preview";
import { createPersistentBackupSnapshot, verifyBackupSnapshotForUser } from "@/lib/ops-persistence";
import { prisma } from "@/lib/prisma";
import type { BackupV13V2Artifact } from "@/lib/contracts";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("Consultation m13.v3 backup round-trip", () => {
  afterEach(async () => {
    restoreTestUtils.resetHooks();
    await prisma.consultation.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.analysis.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("exports and atomically restores Client, Analysis and Consultation", async () => {
    const ownerUserId = randomUUID();
    const clientId = randomUUID();
    const analysisId = randomUUID();
    const consultationId = randomUUID();
    owners.add(ownerUserId);
    await prisma.user.create({ data: {
      id: ownerUserId,
      email: `${ownerUserId}@backup-v3.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    } });
    await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Backup Client" } });
    await prisma.analysis.create({ data: {
      id: analysisId,
      ownerUserId,
      clientId,
      goal: "refresh",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.95,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: ["shape"],
      safetyNotes: [],
      clarificationAnswers: [],
    } });
    await prisma.consultation.create({ data: {
      id: consultationId,
      ownerUserId,
      clientId,
      analysisId,
      summary: "Round trip",
      nextSteps: ["first", "second"],
      createdAt: new Date("2026-07-25T10:00:00.000Z"),
    } });

    const backup = await createPersistentBackupSnapshot({ ownerUserId, createdByUserId: ownerUserId, label: "v3" });
    const row = await prisma.opsBackupSnapshot.findUniqueOrThrow({ where: { id: backup.id } });
    expect(row.schemaVersion).toBe(BACKUP_V13_V3_SCHEMA_VERSION);
    expect(isBackupV13V3Artifact(row.snapshotJson)).toBe(true);
    if (!isBackupV13V3Artifact(row.snapshotJson)) throw new Error("Expected v3 artifact");
    expect(row.snapshotJson.counts.consultations).toBe(1);
    expect(row.snapshotJson.summarySnapshot.consultationsCount).toBe(1);
    expect(row.snapshotJson.sections.consultations).toEqual([{ 
      id: consultationId,
      ownerUserId,
      clientId,
      analysisId,
      summary: "Round trip",
      nextSteps: ["first", "second"],
      createdAt: "2026-07-25T10:00:00.000Z",
    }]);
    expect(computeArtifactChecksumHex(row.snapshotJson)).toBe(row.checksum);
    await expect(verifyBackupSnapshotForUser(ownerUserId, backup.id)).resolves.toMatchObject({
      artifactValidity: "valid",
      recoveryArtifactStatus: "verification_ready",
    });

    await prisma.consultation.update({ where: { id: consultationId }, data: { summary: "Changed outside API" } });
    const preview = await getBackupRestorePreviewForUser(ownerUserId, backup.id);
    const result = await executeBackupRestoreForUser(ownerUserId, backup.id, {
      previewFingerprint: preview.previewFingerprint,
      currentStateFingerprint: preview.currentStateFingerprint,
      strategy: "replace_all",
      acknowledgeDataLoss: true,
    });

    expect(result.restoredCounts.consultations).toBe(1);
    await expect(prisma.consultation.findUnique({ where: { id: consultationId } })).resolves.toMatchObject({
      ownerUserId,
      clientId,
      analysisId,
      summary: "Round trip",
      nextSteps: ["first", "second"],
    });
  });

  it("requires a matching post-preview v3 safety backup before legacy replacement", async () => {
    const { ownerUserId, consultationId } = await seedConsultation();
    const legacyId = await createLegacyV2Backup(ownerUserId);

    const previewGeneratedAt = new Date(Date.now() - 1000).toISOString();
    const preview = await getBackupRestorePreviewForUser(ownerUserId, legacyId, previewGeneratedAt);
    const baseRequest = {
      previewFingerprint: preview.previewFingerprint,
      currentStateFingerprint: preview.currentStateFingerprint,
      strategy: "replace_all" as const,
      acknowledgeDataLoss: true as const,
      previewGeneratedAt,
    };
    await expect(executeBackupRestoreForUser(ownerUserId, legacyId, baseRequest)).rejects.toMatchObject({
      code: "BACKUP_RESTORE_LEGACY_CONSULTATION_SAFETY_REQUIRED",
      httpStatus: 409,
    });
    await expect(prisma.consultation.count({ where: { id: consultationId } })).resolves.toBe(1);

    const safety = await createPersistentBackupSnapshot({ ownerUserId, createdByUserId: ownerUserId, label: "safety-v3" });
    const result = await executeBackupRestoreForUser(ownerUserId, legacyId, {
      ...baseRequest,
      consultationSafetyBackupId: safety.id,
      acknowledgeLegacyConsultationDataLoss: true,
    });
    expect(result.status).toBe("completed");
    await expect(prisma.consultation.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects invalid owner, time, checksum and state safety bindings", async () => {
    const { ownerUserId, consultationId } = await seedConsultation();
    const legacyId = await createLegacyV2Backup(ownerUserId);
    const previewGeneratedAt = new Date(Date.now() - 1000).toISOString();
    const preview = await getBackupRestorePreviewForUser(ownerUserId, legacyId, previewGeneratedAt);
    const request = {
      previewFingerprint: preview.previewFingerprint,
      currentStateFingerprint: preview.currentStateFingerprint,
      strategy: "replace_all" as const,
      acknowledgeDataLoss: true as const,
      acknowledgeLegacyConsultationDataLoss: true as const,
      previewGeneratedAt,
    };

    const { ownerUserId: otherOwnerUserId } = await seedConsultation();
    const otherOwnerSafety = await createPersistentBackupSnapshot({
      ownerUserId: otherOwnerUserId,
      createdByUserId: otherOwnerUserId,
      label: "wrong-owner",
    });
    await expect(executeBackupRestoreForUser(ownerUserId, legacyId, {
      ...request,
      consultationSafetyBackupId: otherOwnerSafety.id,
    })).rejects.toMatchObject({ code: "BACKUP_RESTORE_CONSULTATION_SAFETY_BACKUP_INVALID", httpStatus: 409 });

    const oldSafety = await createPersistentBackupSnapshot({ ownerUserId, createdByUserId: ownerUserId, label: "old" });
    await prisma.opsBackupSnapshot.update({
      where: { id: oldSafety.id },
      data: { createdAt: new Date(new Date(previewGeneratedAt).getTime() - 1000) },
    });
    await expect(executeBackupRestoreForUser(ownerUserId, legacyId, {
      ...request,
      consultationSafetyBackupId: oldSafety.id,
    })).rejects.toMatchObject({ code: "BACKUP_RESTORE_CONSULTATION_SAFETY_BACKUP_INVALID", httpStatus: 409 });

    const corruptSafety = await createPersistentBackupSnapshot({ ownerUserId, createdByUserId: ownerUserId, label: "corrupt" });
    await prisma.opsBackupSnapshot.update({ where: { id: corruptSafety.id }, data: { checksum: "0".repeat(64) } });
    await expect(executeBackupRestoreForUser(ownerUserId, legacyId, {
      ...request,
      consultationSafetyBackupId: corruptSafety.id,
    })).rejects.toMatchObject({ code: "BACKUP_RESTORE_CONSULTATION_SAFETY_BACKUP_STATE_MISMATCH", httpStatus: 409 });

    const staleSafety = await createPersistentBackupSnapshot({ ownerUserId, createdByUserId: ownerUserId, label: "stale-state" });
    await prisma.consultation.update({ where: { id: consultationId }, data: { summary: "Intervening mutation" } });
    const changedPreviewGeneratedAt = new Date(Date.now() - 1000).toISOString();
    const changedPreview = await getBackupRestorePreviewForUser(ownerUserId, legacyId, changedPreviewGeneratedAt);
    await expect(executeBackupRestoreForUser(ownerUserId, legacyId, {
      ...request,
      previewFingerprint: changedPreview.previewFingerprint,
      currentStateFingerprint: changedPreview.currentStateFingerprint,
      previewGeneratedAt: changedPreviewGeneratedAt,
      consultationSafetyBackupId: staleSafety.id,
    })).rejects.toMatchObject({ code: "BACKUP_RESTORE_CONSULTATION_SAFETY_BACKUP_STATE_MISMATCH", httpStatus: 409 });
    await expect(prisma.consultation.findUnique({ where: { id: consultationId } })).resolves.toMatchObject({
      summary: "Intervening mutation",
    });
  });

  it("rejects an orphan Consultation before mutating current state", async () => {
    const { ownerUserId, consultationId } = await seedConsultation();
    const backup = await createPersistentBackupSnapshot({ ownerUserId, createdByUserId: ownerUserId, label: "orphan" });
    const row = await prisma.opsBackupSnapshot.findUniqueOrThrow({ where: { id: backup.id } });
    if (!isBackupV13V3Artifact(row.snapshotJson)) throw new Error("Expected v3 artifact");
    const artifact = structuredClone(row.snapshotJson);
    artifact.sections.consultations[0]!.analysisId = randomUUID();
    artifact.checksum = computeArtifactChecksumHex(artifact);
    await prisma.opsBackupSnapshot.update({
      where: { id: backup.id },
      data: { snapshotJson: artifact as unknown as Prisma.InputJsonValue, checksum: artifact.checksum },
    });

    const preview = await getBackupRestorePreviewForUser(ownerUserId, backup.id);
    await expect(executeBackupRestoreForUser(ownerUserId, backup.id, {
      previewFingerprint: preview.previewFingerprint,
      currentStateFingerprint: preview.currentStateFingerprint,
      strategy: "replace_all",
      acknowledgeDataLoss: true,
    })).rejects.toMatchObject({ code: "BACKUP_RESTORE_REFERENCE_COLLISION", httpStatus: 409 });
    await expect(prisma.consultation.findUnique({ where: { id: consultationId } })).resolves.toMatchObject({
      summary: "Protected",
      nextSteps: ["keep"],
    });
  });

  it("rolls back the current Consultation when execution fails after deletion", async () => {
    const { ownerUserId, consultationId } = await seedConsultation();
    const backup = await createPersistentBackupSnapshot({ ownerUserId, createdByUserId: ownerUserId, label: "rollback" });
    await prisma.consultation.update({ where: { id: consultationId }, data: { summary: "Current must survive" } });
    const preview = await getBackupRestorePreviewForUser(ownerUserId, backup.id);
    restoreTestUtils.setAfterDeletePhaseHook(() => {
      throw new Error("forced Consultation rollback");
    });

    await expect(executeBackupRestoreForUser(ownerUserId, backup.id, {
      previewFingerprint: preview.previewFingerprint,
      currentStateFingerprint: preview.currentStateFingerprint,
      strategy: "replace_all",
      acknowledgeDataLoss: true,
    })).rejects.toThrow("forced Consultation rollback");
    await expect(prisma.consultation.findUnique({ where: { id: consultationId } })).resolves.toMatchObject({
      summary: "Current must survive",
      nextSteps: ["keep"],
    });
  });
});

async function seedConsultation() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  const analysisId = randomUUID();
  const consultationId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: {
    id: ownerUserId,
    email: `${ownerUserId}@legacy-safety.test`,
    passwordHash: "test",
    role: "professional",
    locale: "en",
  } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Safety Client" } });
  await prisma.analysis.create({ data: {
    id: analysisId,
    ownerUserId,
    clientId,
    goal: "refresh",
    hairType: "medium",
    density: "medium",
    porosity: "medium",
    phase: "ready",
    clarificationRound: 0,
    confidenceScore: 0.9,
    uncertaintyReasons: [],
    followUpQuestions: [],
    recommendations: [],
    safetyNotes: [],
    clarificationAnswers: [],
  } });
  await prisma.consultation.create({ data: {
    id: consultationId,
    ownerUserId,
    clientId,
    analysisId,
    summary: "Protected",
    nextSteps: ["keep"],
  } });
  return { ownerUserId, clientId, analysisId, consultationId };
}

async function createLegacyV2Backup(ownerUserId: string): Promise<string> {
  const source = await createPersistentBackupSnapshot({ ownerUserId, createdByUserId: ownerUserId, label: "source-v3" });
  const sourceRow = await prisma.opsBackupSnapshot.findUniqueOrThrow({ where: { id: source.id } });
  if (!isBackupV13V3Artifact(sourceRow.snapshotJson)) throw new Error("Expected v3 artifact");
  const legacyId = `c${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const { consultations: _consultationCount, ...counts } = sourceRow.snapshotJson.counts;
  const { consultations: _consultationLimit, ...maxRowsPerSection } = sourceRow.snapshotJson.limits.maxRowsPerSection;
  const { consultations: _consultations, ...sections } = sourceRow.snapshotJson.sections;
  const artifact: BackupV13V2Artifact = {
    ...sourceRow.snapshotJson,
    schemaVersion: BACKUP_V13_V2_SCHEMA_VERSION,
    backupId: legacyId,
    checksum: null,
    counts,
    limits: { ...sourceRow.snapshotJson.limits, maxRowsPerSection },
    sections,
  };
  artifact.checksum = computeArtifactChecksumHex(artifact);
  await prisma.opsBackupSnapshot.create({ data: {
    id: legacyId,
    ownerUserId,
    label: "legacy-v2",
    snapshotJson: artifact as unknown as Prisma.InputJsonValue,
    checksum: artifact.checksum,
    checksumAlgorithm: "sha256",
    schemaVersion: BACKUP_V13_V2_SCHEMA_VERSION,
    createdByUserId: ownerUserId,
  } });
  return legacyId;
}
