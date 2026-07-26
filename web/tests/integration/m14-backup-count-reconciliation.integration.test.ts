import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  BACKUP_V13_V3_SCHEMA_VERSION,
  computeArtifactChecksumHex,
  isBackupV13V3Artifact,
} from "@/lib/backup-v13-artifact";
import { createPersistentBackupSnapshot, verifyBackupSnapshotForUser } from "@/lib/ops-persistence";
import { prisma } from "@/lib/prisma";

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("M14 backup count reconciliation", () => {
  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.appointment.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("captures owner-scoped Appointment and Notification counts in the unchanged M13 artifact", async () => {
    const first = await createOwnerFixture();
    const second = await createOwnerFixture();
    await createAppointmentAndNotification(first, 2);
    await createAppointmentAndNotification(second, 1);

    const backup = await createPersistentBackupSnapshot({
      ownerUserId: first.ownerUserId,
      createdByUserId: first.ownerUserId,
      label: "m14-count-reconciliation",
    });
    const row = await prisma.opsBackupSnapshot.findUniqueOrThrow({ where: { id: backup.id } });

    expect(row.schemaVersion).toBe(BACKUP_V13_V3_SCHEMA_VERSION);
    expect(isBackupV13V3Artifact(row.snapshotJson)).toBe(true);
    if (!isBackupV13V3Artifact(row.snapshotJson)) throw new Error("Expected m13.v3 artifact");
    expect(row.snapshotJson.summarySnapshot).toMatchObject({
      appointmentsCount: 2,
      notificationsCount: 2,
    });
    expect(Object.keys(row.snapshotJson.sections)).not.toContain("appointments");
    expect(Object.keys(row.snapshotJson.sections)).not.toContain("notifications");
    expect(computeArtifactChecksumHex(row.snapshotJson)).toBe(row.checksum);
    await expect(verifyBackupSnapshotForUser(first.ownerUserId, backup.id)).resolves.toMatchObject({
      artifactValidity: "valid",
      recoveryArtifactStatus: "verification_ready",
    });
  });
});

async function createOwnerFixture() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@m14-backup.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Backup Client" } });
  return { ownerUserId, clientId };
}

async function createAppointmentAndNotification(
  fixture: { ownerUserId: string; clientId: string },
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    const appointment = await prisma.appointment.create({
      data: {
        ownerUserId: fixture.ownerUserId,
        clientId: fixture.clientId,
        title: `Appointment ${index}`,
        startsAt: new Date(`2026-08-0${index + 1}T10:00:00.000Z`),
        reminderMinutesBefore: 60,
        reminderType: "appointment",
        notes: "",
      },
    });
    await prisma.notification.create({
      data: {
        ownerUserId: fixture.ownerUserId,
        type: "appointment",
        title: `Reminder ${index}`,
        message: "Upcoming appointment",
        relatedClientId: fixture.clientId,
        relatedAppointmentId: appointment.id,
      },
    });
  }
}