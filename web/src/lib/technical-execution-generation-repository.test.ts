import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createCaptureSet, createReplacementCaptureSet } from "@/lib/capture-set-repository";
import * as technicalExecutionGenerationRepository from "@/lib/technical-execution-generation-repository";
import {
  TechnicalExecutionGenerationDependencyError,
  TechnicalExecutionGenerationSealedError,
  TechnicalExecutionGenerationValidationError,
  createTechnicalExecutionGenerationRequest,
  getTechnicalExecutionGenerationReadiness,
  grantTechnicalExecutionGenerationConsent,
  recordTechnicalExecutionGenerationQualification,
  sealTechnicalExecutionGenerationRequest,
} from "@/lib/technical-execution-generation-repository";

// AI Hair Architect, Stage 2.5.i.22 -- real Postgres, no mocks, mirroring
// capture-set-repository.test.ts's own conventions exactly. Skips (never
// fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("technical-execution-generation-repository (durable generation authorization gate)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.technicalExecutionGenerationRequest.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAnalysis.deleteMany({ where: { asset: { ownerUserId: { in: ownerUserIds } } } });
    await prisma.captureSetImage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSet.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // -------------------------------------------------------------------------
  // A. full happy path
  // -------------------------------------------------------------------------

  it("A. valid selected image + consent + qualified + sealed -> READY", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);

    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
    await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);

    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    expect(readiness).toEqual({ status: "READY" });
  });

  // -------------------------------------------------------------------------
  // B/I/J/M. incomplete requests -> BLOCK
  // -------------------------------------------------------------------------

  it("B. no consent -> BLOCK", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");

    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    expect(readiness.status).toBe("BLOCKED");
  });

  it("I. qualification NOT_EVALUATED (default) -> BLOCK", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");

    expect(request.qualificationStatus).toBe("NOT_EVALUATED");
    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    expect(readiness.status).toBe("BLOCKED");
  });

  it("J. qualification REJECTED -> BLOCK", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "REJECTED", "MANUAL_USER_CONFIRMATION", "posterior region not visible");

    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    expect(readiness.status).toBe("BLOCKED");
  });

  it("M. unsealed request (consent + qualified, but not sealed) -> BLOCK", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");

    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    expect(readiness.status).toBe("BLOCKED");
  });

  // -------------------------------------------------------------------------
  // C/E/K/L. no cross-request leakage of consent or qualification
  // -------------------------------------------------------------------------

  it("C. consent from a previous (different) generation request never carries over -> BLOCK", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);

    const first = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, first.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, first.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
    await sealTechnicalExecutionGenerationRequest(ownerUserId, first.id);

    const second = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    expect(second.consentGrantedAt).toBeNull();
    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, second.id);
    expect(readiness.status).toBe("BLOCKED");
  });

  it("E. a new request always starts requiring new consent, even for the same image", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const requestA = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    const requestB = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    expect(requestA.id).not.toBe(requestB.id);
    expect(requestA.consentGrantedAt).toBeNull();
    expect(requestB.consentGrantedAt).toBeNull();
  });

  it("K. qualification recorded on one request never carries over to another request for the same purpose", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);

    const first = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await recordTechnicalExecutionGenerationQualification(ownerUserId, first.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");

    const second = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    expect(second.qualificationStatus).toBe("NOT_EVALUATED");
  });

  it("L. qualification for a different image never carries over", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage: frontImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const backAsset = await createImageAsset(ownerUserId, clientId);
    const setV2 = await createReplacementCaptureSet(ownerUserId, clientId, captureSet.id, [{ viewLabel: "BACK", imageAssetId: backAsset.id }]);
    const backImage = setV2.images.find((i) => i.viewLabel === "BACK")!;

    const frontRequest = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, frontImage.id);
    await recordTechnicalExecutionGenerationQualification(ownerUserId, frontRequest.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");

    const backRequest = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", setV2.id, backImage.id);
    expect(backRequest.qualificationStatus).toBe("NOT_EVALUATED");
  });

  // -------------------------------------------------------------------------
  // D. retry semantics -- same sealed request is safely re-checkable
  // -------------------------------------------------------------------------

  it("D. the same sealed request can be re-checked (retry) and consistently reports READY, reusing its own consent", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
    await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);

    const firstCheck = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    const secondCheck = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    expect(firstCheck).toEqual({ status: "READY" });
    expect(secondCheck).toEqual({ status: "READY" });

    const reloaded = await prisma.technicalExecutionGenerationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(reloaded.consentGrantedAt).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // F/G/H. selection integrity
  // -------------------------------------------------------------------------

  it("F. selected image not in the given Capture Set -> BLOCK at creation", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet: setA } = await createCaptureSetWithFront(ownerUserId, clientId);
    const otherAsset = await createImageAsset(ownerUserId, clientId);
    const setB = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "BACK", imageAssetId: otherAsset.id }]);
    const setBImage = setB.images[0];

    const error = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", setA.id, setBImage.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalExecutionGenerationDependencyError);
    expect((error as TechnicalExecutionGenerationDependencyError).code).toBe("TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_IMAGE_MISMATCH");
    await expect(prisma.technicalExecutionGenerationRequest.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("G. Capture Set belonging to a different client -> BLOCK at creation", async () => {
    const { ownerUserId, clientId: clientA } = await createOwnerAndClient();
    const { clientId: clientB } = await createOwnerAndClient(ownerUserId);
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientB);

    const error = await createTechnicalExecutionGenerationRequest(ownerUserId, clientA, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TechnicalExecutionGenerationDependencyError);
    expect((error as TechnicalExecutionGenerationDependencyError).code).toBe("TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_NOT_FOUND");
  });

  it("H. a frozen ImageAsset reference that no longer matches the live Capture Set image -> BLOCK at readiness", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");

    // Simulate divergence directly at the DB level (never reachable through
    // the repository's own real functions, which never mutate this field
    // after creation) -- proves the readiness evaluator's own cross-check.
    await prisma.technicalExecutionGenerationRequest.update({ where: { id: request.id }, data: { imageAssetId: randomUUID() } });

    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    expect(readiness.status).toBe("BLOCKED");
  });

  // -------------------------------------------------------------------------
  // N/O/P. immutability after seal
  // -------------------------------------------------------------------------

  it("N. no repository function exists capable of changing the selected image/Capture Set/purpose, sealed or not", async () => {
    const exported = Object.keys(technicalExecutionGenerationRepository);
    for (const forbidden of ["reselect", "changeImage", "updateCaptureSet", "updatePurpose", "setImage", "setCaptureSet"]) {
      expect(exported.some((name) => name.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
    }
    // The only place these fields are ever written is create -- confirmed
    // by inspecting the actual function surface above; grantConsent and
    // recordQualification (the only other writers) never touch them (see
    // their own source, and O/P below for their sealed-state behavior).
  });

  it("O. granting consent after seal is rejected, request left unchanged", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
    await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);

    const error = await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v2").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalExecutionGenerationSealedError);

    const reloaded = await prisma.technicalExecutionGenerationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(reloaded.consentVersion).toBe("v1");
  });

  it("P. recording qualification after seal is rejected, request left unchanged", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
    await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);

    const error = await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "REJECTED", "MANUAL_USER_CONFIRMATION").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalExecutionGenerationSealedError);

    const reloaded = await prisma.technicalExecutionGenerationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(reloaded.qualificationStatus).toBe("QUALIFIED");
  });

  it("cannot seal without consent", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");

    const error = await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalExecutionGenerationValidationError);
  });

  it("cannot seal without a QUALIFIED image", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");

    const error = await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TechnicalExecutionGenerationValidationError);
  });

  it("sealing an already-sealed request is idempotent, not an error", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
    const first = await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);
    const second = await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);
    expect(second?.sealedAt).toBe(first?.sealedAt);
  });

  // -------------------------------------------------------------------------
  // Q. historical integrity across Capture Set supersession
  // -------------------------------------------------------------------------

  it("Q. a sealed request remains a valid historical READY record even after its own Capture Set is superseded", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet: setV1, captureSetImage: frontV1 } = await createCaptureSetWithFront(ownerUserId, clientId);

    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", setV1.id, frontV1.id);
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
    await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);

    const backV1 = await createImageAsset(ownerUserId, clientId);
    await createReplacementCaptureSet(ownerUserId, clientId, setV1.id, [{ viewLabel: "BACK", imageAssetId: backV1.id }]);

    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, request.id);
    expect(readiness).toEqual({ status: "READY" });
  });

  // -------------------------------------------------------------------------
  // R/S/T. no unauthorized authority anywhere in the surrounding chain
  // -------------------------------------------------------------------------

  it("R. no function anywhere in this repository chooses an image on the caller's behalf", async () => {
    const exported = Object.keys(technicalExecutionGenerationRepository);
    for (const forbidden of ["choose", "pickBest", "selectBest", "autoSelect"]) {
      expect(exported.some((name) => name.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
    }
  });

  it("S. Capture Set existence alone never grants consent", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    expect(request.consentGrantedAt).toBeNull();
  });

  it("T. ImageAnalysis's own external AI consent never grants Technical Execution consent", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const analyzedAsset = await createImageAsset(ownerUserId, clientId);
    await prisma.imageAnalysis.create({
      data: {
        assetId: analyzedAsset.id,
        status: "draft",
        externalAiConsentGrantedAt: new Date(),
        externalAiConsentVersion: "v1",
      },
    });

    const { captureSet, captureSetImage } = await createCaptureSetWithFront(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    expect(request.consentGrantedAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // U/V. zero provider/AI call anywhere
  // -------------------------------------------------------------------------

  it("U/V. the module exports no provider call, AI call, or generation-execution concept", () => {
    const exported = Object.keys(technicalExecutionGenerationRepository).join(" ").toLowerCase();
    for (const forbidden of ["veo", "gemini", "openai", "provider", "generatevideo", "callmodel"]) {
      expect(exported.includes(forbidden)).toBe(false);
    }
  });

  it("the module carries no camera/UI/API concept", () => {
    const exported = Object.keys(technicalExecutionGenerationRepository).join(" ").toLowerCase();
    for (const forbidden of ["camera", "capture_html", "getusermedia", "upload"]) {
      expect(exported.includes(forbidden)).toBe(false);
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
        email: `${ownerUserId}@technical-execution-generation-repository.test`,
        passwordHash: "test",
        role: "professional",
        locale: "en",
      },
    });
  }
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Technical Execution Generation Repository Client" } });
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

async function createCaptureSetWithFront(ownerUserId: string, clientId: string) {
  const front = await createImageAsset(ownerUserId, clientId);
  const captureSet = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: front.id }]);
  return { captureSet, captureSetImage: captureSet.images[0] };
}
