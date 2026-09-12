import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  CaptureSetDependencyError,
  CaptureSetValidationError,
  createCaptureSet,
  createReplacementCaptureSet,
  findCaptureSetForOwner,
  getCurrentCaptureSetForClient,
  listCaptureSetHistory,
} from "@/lib/capture-set-repository";
import { isCompleteCaptureSetViewSet, missingCaptureSetViews, type CaptureSetImageInput } from "@/lib/capture-set-validators";

// AI Hair Architect, Stage 2.5.i.21b -- real Postgres, no mocks, mirroring
// technical-visual-map-repository.test.ts's own conventions exactly (a
// tracked `owners` Set cleaned up in afterEach). Skips (never fails) when
// no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("capture-set-repository (durable Capture Set domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.captureSetImage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSet.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // -------------------------------------------------------------------------
  // A/C/D. create with all 4 views, and incomplete sets
  // -------------------------------------------------------------------------

  it("A. creates a Capture Set with FRONT/LEFT/BACK/RIGHT, version 1, not superseded", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const left = await createImageAsset(ownerUserId, clientId);
    const back = await createImageAsset(ownerUserId, clientId);
    const right = await createImageAsset(ownerUserId, clientId);

    const set = await createCaptureSet(ownerUserId, clientId, [
      { viewLabel: "FRONT", imageAssetId: front.id },
      { viewLabel: "LEFT", imageAssetId: left.id },
      { viewLabel: "BACK", imageAssetId: back.id },
      { viewLabel: "RIGHT", imageAssetId: right.id },
    ]);

    expect(set).toMatchObject({ ownerUserId, clientId, captureSetVersion: 1, supersededByCaptureSetId: null });
    expect(set.images).toHaveLength(4);
    expect(isCompleteCaptureSetViewSet(set.images.map((i) => i.viewLabel))).toBe(true);

    const row = await prisma.captureSet.findUniqueOrThrow({ where: { id: set.id }, include: { images: true } });
    expect(row.images).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  // Stage 8.5L3.1 -- SEMANTIC CLEANUP: purpose / ordinalPosition
  // -------------------------------------------------------------------------

  it("40. defaults to purpose=CLIENT_MULTIVIEW when omitted -- every existing call site keeps its exact current behavior", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);

    const set = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);

    expect(set.purpose).toBe("CLIENT_MULTIVIEW");
    expect(set.images[0].ordinalPosition).toBeNull();
    const row = await prisma.captureSet.findUniqueOrThrow({ where: { id: set.id } });
    expect(row.purpose).toBe("CLIENT_MULTIVIEW");
  });

  it("39. an explicit PROFESSIONAL_LEARNING_SET purpose with real ordinalPosition values round-trips correctly", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const first = await createImageAsset(ownerUserId, clientId);
    const second = await createImageAsset(ownerUserId, clientId);

    const set = await createCaptureSet(
      ownerUserId,
      clientId,
      [
        { viewLabel: "FRONT", imageAssetId: first.id, ordinalPosition: 1 },
        { viewLabel: "LEFT", imageAssetId: second.id, ordinalPosition: 2 },
      ],
      "PROFESSIONAL_LEARNING_SET",
    );

    expect(set.purpose).toBe("PROFESSIONAL_LEARNING_SET");
    expect(set.images.map((i) => i.ordinalPosition).sort()).toEqual([1, 2]);
  });

  it("a replacement CaptureSet inherits the base row's own purpose", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const first = await createImageAsset(ownerUserId, clientId);
    const base = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: first.id, ordinalPosition: 1 }], "PROFESSIONAL_LEARNING_SET");

    const second = await createImageAsset(ownerUserId, clientId);
    const replacement = await createReplacementCaptureSet(ownerUserId, clientId, base.id, [{ viewLabel: "LEFT", imageAssetId: second.id, ordinalPosition: 2 }]);

    expect(replacement.purpose).toBe("PROFESSIONAL_LEARNING_SET");
  });

  it("C/D. creates an incomplete set (only FRONT+BACK) and correctly detects incompleteness, listing the missing views", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const back = await createImageAsset(ownerUserId, clientId);

    const set = await createCaptureSet(ownerUserId, clientId, [
      { viewLabel: "FRONT", imageAssetId: front.id },
      { viewLabel: "BACK", imageAssetId: back.id },
    ]);

    const views = set.images.map((i) => i.viewLabel);
    expect(isCompleteCaptureSetViewSet(views)).toBe(false);
    expect([...missingCaptureSetViews(views)].sort()).toEqual(["LEFT", "RIGHT"]);
  });

  it("rejects an empty image list -- a Capture Set with zero images is meaningless", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const error = await createCaptureSet(ownerUserId, clientId, []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureSetValidationError);
    expect((error as CaptureSetValidationError).code).toBe("CAPTURE_SET_EMPTY_IMAGES");
    await expect(prisma.captureSet.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects a structurally invalid view label, with no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const invalid = [{ viewLabel: "TOP", imageAssetId: front.id }] as unknown as CaptureSetImageInput[];

    const error = await createCaptureSet(ownerUserId, clientId, invalid).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureSetValidationError);
    expect((error as CaptureSetValidationError).code).toBe("CAPTURE_SET_INVALID_IMAGE");
    await expect(prisma.captureSet.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  // -------------------------------------------------------------------------
  // B. cardinality -- no duplicate view within one set
  // -------------------------------------------------------------------------

  it("B. rejects two FRONT images in the same set, with no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const frontA = await createImageAsset(ownerUserId, clientId);
    const frontB = await createImageAsset(ownerUserId, clientId);

    const error = await createCaptureSet(ownerUserId, clientId, [
      { viewLabel: "FRONT", imageAssetId: frontA.id },
      { viewLabel: "FRONT", imageAssetId: frontB.id },
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CaptureSetValidationError);
    expect((error as CaptureSetValidationError).code).toBe("CAPTURE_SET_DUPLICATE_VIEW");
    await expect(prisma.captureSet.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("the DB-level unique constraint (captureSetId, viewLabel) is the final backstop, independent of the domain check", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const set = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);

    const anotherFront = await createImageAsset(ownerUserId, clientId);
    await expect(
      prisma.captureSetImage.create({
        data: { id: randomUUID(), ownerUserId, clientId, captureSetId: set.id, imageAssetId: anotherFront.id, viewLabel: "FRONT" },
      }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // E/F/G. reads
  // -------------------------------------------------------------------------

  it("E. obtains a specific Capture Set by id, owner-scoped", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const set = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);

    const found = await findCaptureSetForOwner(ownerUserId, set.id);
    expect(found?.id).toBe(set.id);

    const other = await createOwnerAndClient();
    const notFound = await findCaptureSetForOwner(other.ownerUserId, set.id);
    expect(notFound).toBeNull();
  });

  it("F. obtains the current Capture Set for a client -- null when none exist yet", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    expect(await getCurrentCaptureSetForClient(ownerUserId, clientId)).toBeNull();

    const front = await createImageAsset(ownerUserId, clientId);
    const set = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);

    const current = await getCurrentCaptureSetForClient(ownerUserId, clientId);
    expect(current?.id).toBe(set.id);
  });

  it("G. lists Capture Set history in stable, newest-version-first order", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const frontV1 = await createImageAsset(ownerUserId, clientId);
    const v1 = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: frontV1.id }]);

    const frontV2 = await createImageAsset(ownerUserId, clientId);
    const v2 = await createReplacementCaptureSet(ownerUserId, clientId, v1.id, [{ viewLabel: "FRONT", imageAssetId: frontV2.id }]);

    const history = await listCaptureSetHistory(ownerUserId, clientId);
    expect(history.map((s) => s.id)).toEqual([v2.id, v1.id]);
    expect(history.map((s) => s.captureSetVersion)).toEqual([2, 1]);
  });

  // -------------------------------------------------------------------------
  // H/I/J/K. replacement / versioning / historical integrity
  // -------------------------------------------------------------------------

  it("H/I. replacement creates a NEW set and does not modify the old one", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const frontV1 = await createImageAsset(ownerUserId, clientId);
    const backV1 = await createImageAsset(ownerUserId, clientId);
    const v1 = await createCaptureSet(ownerUserId, clientId, [
      { viewLabel: "FRONT", imageAssetId: frontV1.id },
      { viewLabel: "BACK", imageAssetId: backV1.id },
    ]);

    const backV2 = await createImageAsset(ownerUserId, clientId);
    const v2 = await createReplacementCaptureSet(ownerUserId, clientId, v1.id, [{ viewLabel: "BACK", imageAssetId: backV2.id }]);

    expect(v2.id).not.toBe(v1.id);
    expect(v2.captureSetVersion).toBe(2);

    // I: v1's own row and images are byte-unchanged.
    const v1Reloaded = await prisma.captureSet.findUniqueOrThrow({ where: { id: v1.id }, include: { images: true } });
    expect(v1Reloaded.images.find((i) => i.viewLabel === "BACK")?.imageAssetId).toBe(backV1.id);
    expect(v1Reloaded.images.find((i) => i.viewLabel === "FRONT")?.imageAssetId).toBe(frontV1.id);
  });

  it("J. an unchanged view's image is reused (referenced, not duplicated) in the new set", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const backV1 = await createImageAsset(ownerUserId, clientId);
    const v1 = await createCaptureSet(ownerUserId, clientId, [
      { viewLabel: "FRONT", imageAssetId: front.id },
      { viewLabel: "BACK", imageAssetId: backV1.id },
    ]);

    const backV2 = await createImageAsset(ownerUserId, clientId);
    const v2 = await createReplacementCaptureSet(ownerUserId, clientId, v1.id, [{ viewLabel: "BACK", imageAssetId: backV2.id }]);

    const v2Front = v2.images.find((i) => i.viewLabel === "FRONT");
    expect(v2Front?.imageAssetId).toBe(front.id);
  });

  it("K. BACK_v1 remains in V1 while V2 uses BACK_v2 -- both versions independently readable", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const backV1 = await createImageAsset(ownerUserId, clientId);
    const v1 = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "BACK", imageAssetId: backV1.id }]);

    const backV2 = await createImageAsset(ownerUserId, clientId);
    const v2 = await createReplacementCaptureSet(ownerUserId, clientId, v1.id, [{ viewLabel: "BACK", imageAssetId: backV2.id }]);

    const reloadedV1 = await findCaptureSetForOwner(ownerUserId, v1.id);
    const reloadedV2 = await findCaptureSetForOwner(ownerUserId, v2.id);
    expect(reloadedV1?.images.find((i) => i.viewLabel === "BACK")?.imageAssetId).toBe(backV1.id);
    expect(reloadedV2?.images.find((i) => i.viewLabel === "BACK")?.imageAssetId).toBe(backV2.id);
  });

  // -------------------------------------------------------------------------
  // N. historical versioning / superseded semantics
  // -------------------------------------------------------------------------

  it("N. superseded semantics are coherent: v1.supersededByCaptureSetId points to v2; v2 is current; v1 is not", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const v1 = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);

    const frontV2 = await createImageAsset(ownerUserId, clientId);
    const v2 = await createReplacementCaptureSet(ownerUserId, clientId, v1.id, [{ viewLabel: "FRONT", imageAssetId: frontV2.id }]);

    const reloadedV1 = await findCaptureSetForOwner(ownerUserId, v1.id);
    expect(reloadedV1?.supersededByCaptureSetId).toBe(v2.id);
    expect(v2.supersededByCaptureSetId).toBeNull();

    const current = await getCurrentCaptureSetForClient(ownerUserId, clientId);
    expect(current?.id).toBe(v2.id);

    // Never more than one current row -- structurally proven, not merely observed once.
    const currentRows = await prisma.captureSet.count({ where: { ownerUserId, clientId, supersededByCaptureSetId: null } });
    expect(currentRows).toBe(1);
  });

  it("replacing from an already-superseded (non-current) base is rejected", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const v1 = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);
    const frontV2 = await createImageAsset(ownerUserId, clientId);
    await createReplacementCaptureSet(ownerUserId, clientId, v1.id, [{ viewLabel: "FRONT", imageAssetId: frontV2.id }]);

    const frontV3Attempt = await createImageAsset(ownerUserId, clientId);
    const error = await createReplacementCaptureSet(ownerUserId, clientId, v1.id, [{ viewLabel: "FRONT", imageAssetId: frontV3Attempt.id }]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CaptureSetDependencyError);
    expect((error as CaptureSetDependencyError).code).toBe("CAPTURE_SET_BASE_ALREADY_SUPERSEDED");
  });

  it("replacing from a non-existent base Capture Set is rejected", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const error = await createReplacementCaptureSet(ownerUserId, clientId, randomUUID(), [{ viewLabel: "FRONT", imageAssetId: front.id }]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CaptureSetDependencyError);
    expect((error as CaptureSetDependencyError).code).toBe("CAPTURE_SET_BASE_NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // L/M. authorization / ownership -- cross-client, cross-owner
  // -------------------------------------------------------------------------

  it("L. rejects a reference to an ImageAsset belonging to a different client, with no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const otherClient = await createOwnerAndClient(ownerUserId);
    const foreignImage = await createImageAsset(ownerUserId, otherClient.clientId);

    const error = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: foreignImage.id }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureSetDependencyError);
    expect((error as CaptureSetDependencyError).code).toBe("CAPTURE_SET_IMAGE_ASSET_NOT_FOUND");
    await expect(prisma.captureSet.count({ where: { ownerUserId, clientId } })).resolves.toBe(0);
  });

  it("L. rejects a reference to an ImageAsset owned by an entirely different user, with no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const other = await createOwnerAndClient();
    const foreignImage = await createImageAsset(other.ownerUserId, other.clientId);

    const error = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: foreignImage.id }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureSetDependencyError);
    expect((error as CaptureSetDependencyError).code).toBe("CAPTURE_SET_IMAGE_ASSET_NOT_FOUND");
  });

  it("rejects creation for a client not owned by the caller, with no row written", async () => {
    const { clientId } = await createOwnerAndClient();
    const impostor = await createOwnerAndClient();
    const front = await createImageAsset(impostor.ownerUserId, impostor.clientId);

    const error = await createCaptureSet(impostor.ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptureSetDependencyError);
    expect((error as CaptureSetDependencyError).code).toBe("CAPTURE_SET_CLIENT_NOT_FOUND");
  });

  it("M. an ImageAsset is never duplicated -- reused across two Capture Sets still resolves to exactly one ImageAsset row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const v1 = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);
    const back = await createImageAsset(ownerUserId, clientId);
    await createReplacementCaptureSet(ownerUserId, clientId, v1.id, [{ viewLabel: "BACK", imageAssetId: back.id }]);

    const imageCount = await prisma.imageAsset.count({ where: { ownerUserId, clientId, id: front.id } });
    expect(imageCount).toBe(1);
    const asset = await prisma.imageAsset.findUniqueOrThrow({ where: { id: front.id } });
    expect(asset.storagePath).toBe("pending"); // unchanged -- never rewritten by Capture Set logic
  });

  // -------------------------------------------------------------------------
  // O. zero consent/quality/provider behavior
  // -------------------------------------------------------------------------

  it("O. the module exports no consent, quality, or provider concept", async () => {
    const repositoryModule = await import("@/lib/capture-set-repository");
    const validatorsModule = await import("@/lib/capture-set-validators");
    const exported = [...Object.keys(repositoryModule), ...Object.keys(validatorsModule)].join(" ").toLowerCase();
    for (const forbidden of ["consent", "quality", "qualif", "provider", "veo", "gemini", "authorization"]) {
      expect(exported.includes(forbidden)).toBe(false);
    }
  });

  it("O. a Capture Set record itself carries no consent/quality/provider field", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const front = await createImageAsset(ownerUserId, clientId);
    const set = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);

    const keys = [...Object.keys(set), ...Object.keys(set.images[0])].join(" ").toLowerCase();
    for (const forbidden of ["consent", "quality", "qualif", "provider", "authorization"]) {
      expect(keys.includes(forbidden)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerAndClient(existingOwnerUserId?: string) {
  const ownerUserId = existingOwnerUserId ?? randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  if (!existingOwnerUserId) {
    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `${ownerUserId}@capture-set-repository.test`,
        passwordHash: "test",
        role: "professional",
        locale: "en",
      },
    });
  }
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Capture Set Repository Client" } });
  return { ownerUserId, clientId };
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  return prisma.imageAsset.create({
    data: {
      id: randomUUID(),
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12345,
      ownerUserId,
      clientId,
      storagePath: "pending",
    },
  });
}
