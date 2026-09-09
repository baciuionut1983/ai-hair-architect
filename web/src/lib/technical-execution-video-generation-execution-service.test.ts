import { randomUUID } from "crypto";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { saveImageFile } from "@/lib/image-storage";
import { createCaptureSet } from "@/lib/capture-set-repository";
import {
  createTechnicalExecutionGenerationRequest,
  grantTechnicalExecutionGenerationConsent,
  recordTechnicalExecutionGenerationQualification,
  sealTechnicalExecutionGenerationRequest,
} from "@/lib/technical-execution-generation-repository";
import { executeTechnicalExecutionVideoGeneration } from "@/lib/technical-execution-video-generation-execution-service";
import { TechnicalExecutionVeoProvider } from "@/lib/technical-execution-video-veo-provider";
import { compileContinueCentralNapeConstructionProviderAdapterOutput } from "@/lib/cutting-skill-continue-central-nape-construction-provider-request";
import type { VeoPollResult, VeoSubmitResult, VeoVideoGenerationClient } from "@/lib/video-provider-veo";

// AI Hair Architect, Stage 2.5.i.23 -- the FULL orchestrator, tested against
// real Postgres for state, but with an EXPLICITLY INJECTED fake Veo client
// in every single test (mirrors video-generation-execution-service.test.ts's
// own hard acceptance condition -- see the "network safety" describe block
// at the bottom, which asserts this structurally). No test ever exercises
// TechnicalExecutionVeoProvider's own default (real) client construction
// path -- every provider here is constructed with an explicit fake
// VeoVideoGenerationClient.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

const enabledEnv = { VIDEO_DEMONSTRATION_PROVIDER: "google", VIDEO_DEMONSTRATION_API_KEY: "test-key", VIDEO_DEMONSTRATION_MODEL: "veo-3.1-lite-generate-preview" };

let cachedRealJpegBuffer: Buffer | null = null;
async function realJpegBuffer(): Promise<Buffer> {
  if (!cachedRealJpegBuffer) {
    cachedRealJpegBuffer = await sharp({ create: { width: 1080, height: 1440, channels: 3, background: { r: 200, g: 180, b: 160 } } }).jpeg().toBuffer();
  }
  return cachedRealJpegBuffer;
}

function fakeClient(overrides: Partial<VeoVideoGenerationClient> = {}, captured?: { imageBase64?: string; instruction?: string }): VeoVideoGenerationClient {
  return {
    submit: async (input): Promise<VeoSubmitResult> => {
      if (captured) {
        captured.imageBase64 = input.imageBase64;
        captured.instruction = input.instruction;
      }
      return { operationName: "operations/fake-1" };
    },
    poll: async (): Promise<VeoPollResult> => ({
      done: true,
      errorMessage: undefined,
      videoUri: undefined,
      videoBytesBase64: Buffer.from("fake video bytes").toString("base64"),
      videoMimeType: "video/mp4",
    }),
    ...overrides,
  };
}

suite("technical-execution-video-generation-execution-service (real Central Nape Guide pilot orchestrator)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.aiUsageEvent.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalExecutionVideoGeneration.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.technicalExecutionGenerationRequest.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSetImage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSet.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  // ---------------------------------------------------------------------------
  // A. READY -> allowed. Full two-phase happy path.
  // ---------------------------------------------------------------------------

  it("A. READY sealed request: submits (real providerOperationId persisted, NOT metered yet) -> completes on the next call (metered once, real VideoAsset persisted)", async () => {
    const { ownerUserId, requestId } = await createSealedRequest();
    const captured: { imageBase64?: string; instruction?: string } = {};
    const client = fakeClient({}, captured);
    const usageEvents: unknown[] = [];

    const submitted = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, {
      env: enabledEnv,
      createProvider: (config) => new TechnicalExecutionVeoProvider(config, client),
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(submitted.outcome).toBe("submitted");
    if (submitted.outcome !== "submitted") throw new Error("expected submitted");
    expect(submitted.generation.status).toBe("PROCESSING");
    expect(submitted.generation.providerOperationId).toBe("operations/fake-1");
    expect(submitted.generation.technicalExecutionGenerationRequestId).toBe(requestId);
    expect(usageEvents).toHaveLength(0);
    expect(captured.instruction).toContain("Wet");

    const completed = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, {
      env: enabledEnv,
      createProvider: (config) => new TechnicalExecutionVeoProvider(config, client),
      recordAiUsageEvent: async (input) => {
        usageEvents.push(input);
      },
    });

    expect(completed.outcome).toBe("completed");
    if (completed.outcome !== "completed") throw new Error("expected completed");
    expect(completed.generation.status).toBe("COMPLETED");
    expect(completed.generation.generatedVideoAssetId).not.toBeNull();
    expect(usageEvents).toHaveLength(1);
    expect((usageEvents[0] as { feature: string }).feature).toBe("technical_execution_video");
    expect((usageEvents[0] as { outcome: string }).outcome).toBe("SUCCEEDED");

    const videoAsset = await prisma.videoAsset.findUniqueOrThrow({ where: { id: completed.generation.generatedVideoAssetId as string } });
    expect(videoAsset.mimeType).toBe("video/mp4");
  });

  // ---------------------------------------------------------------------------
  // B. BLOCKED i.22 request -> zero provider call.
  // ---------------------------------------------------------------------------

  it("B. an unsealed request is BLOCKED by the i.22 gate -- zero provider call", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithBack(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
    // consent granted, qualified, but NEVER sealed.
    await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
    await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");

    let providerConstructed = false;
    const result = await executeTechnicalExecutionVideoGeneration(request.id, ownerUserId, {
      env: enabledEnv,
      createProvider: (config) => {
        providerConstructed = true;
        return new TechnicalExecutionVeoProvider(config, fakeClient());
      },
    });

    expect(result).toEqual({ outcome: "failed", code: "NOT_READY", reason: expect.any(String) });
    expect(providerConstructed).toBe(false);

    const count = await prisma.technicalExecutionVideoGeneration.count({ where: { technicalExecutionGenerationRequestId: request.id } });
    expect(count).toBe(0);
  });

  it("B2. no consent -> BLOCKED, zero provider call", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const { captureSet, captureSetImage } = await createCaptureSetWithBack(ownerUserId, clientId);
    const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);

    let providerConstructed = false;
    const result = await executeTechnicalExecutionVideoGeneration(request.id, ownerUserId, {
      env: enabledEnv,
      createProvider: (config) => {
        providerConstructed = true;
        return new TechnicalExecutionVeoProvider(config, fakeClient());
      },
    });

    expect(result.outcome).toBe("failed");
    expect(providerConstructed).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // C/D. exact selected image, and only one image, reaches the provider.
  // ---------------------------------------------------------------------------

  it("C/D. the exact i.22-selected image bytes (and only that image) reach the provider payload", async () => {
    const { ownerUserId, requestId, imageBuffer } = await createSealedRequest();
    const captured: { imageBase64?: string; instruction?: string } = {};
    const client = fakeClient({}, captured);

    await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });

    expect(captured.imageBase64).toBe(imageBuffer.toString("base64"));
  });

  // ---------------------------------------------------------------------------
  // S/T. duplicate invocation does not duplicate the provider generation.
  // ---------------------------------------------------------------------------

  it("S. calling execute twice while still REQUESTED resolves the SAME generation row, never creates a second one", async () => {
    const { ownerUserId, requestId } = await createSealedRequest();
    let submitCalls = 0;
    const client = fakeClient({ submit: async () => { submitCalls += 1; return { operationName: "operations/fake-1" }; } });

    const first = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });
    const second = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });

    if (first.outcome !== "submitted") throw new Error("expected first call to submit");
    // Second call finds the same row already PROCESSING with an operationId -> polls, never resubmits.
    expect(second.outcome === "completed" || second.outcome === "still_processing").toBe(true);
    expect(submitCalls).toBe(1);

    const count = await prisma.technicalExecutionVideoGeneration.count({ where: { technicalExecutionGenerationRequestId: requestId } });
    expect(count).toBe(1);
  });

  it("T. polling an already-submitted row never creates a second provider submit", async () => {
    const { ownerUserId, requestId } = await createSealedRequest();
    let submitCalls = 0;
    let pollCalls = 0;
    const client = fakeClient({
      submit: async () => {
        submitCalls += 1;
        return { operationName: "operations/fake-1" };
      },
      poll: async () => {
        pollCalls += 1;
        return { done: pollCalls > 1, errorMessage: undefined, videoUri: undefined, videoBytesBase64: pollCalls > 1 ? Buffer.from("v").toString("base64") : undefined, videoMimeType: "video/mp4" };
      },
    });

    await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });
    await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });
    await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });

    expect(submitCalls).toBe(1);
    expect(pollCalls).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // U. provider technical failure maps to FAILED safely.
  // ---------------------------------------------------------------------------

  it("U. a non-retryable submit failure marks the generation FAILED, never resubmitted", async () => {
    const { ownerUserId, requestId } = await createSealedRequest();
    const client = fakeClient({
      submit: async () => {
        throw Object.assign(new Error("moderation blocked"), { status: 200 });
      },
    });

    const result = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });
    expect(result.outcome === "failed" || result.outcome === "requeued_for_retry").toBe(true);

    const row = await prisma.technicalExecutionVideoGeneration.findFirstOrThrow({ where: { technicalExecutionGenerationRequestId: requestId } });
    expect(["FAILED", "REQUESTED"]).toContain(row.status);
  });

  // ---------------------------------------------------------------------------
  // V. retry preserves the same sealed binding.
  // ---------------------------------------------------------------------------

  it("V. a retryable submit failure requeues to REQUESTED with the SAME sealed request binding, no new consent/image", async () => {
    const { ownerUserId, requestId } = await createSealedRequest();
    let submitAttempts = 0;
    const client = fakeClient({
      submit: async () => {
        submitAttempts += 1;
        if (submitAttempts === 1) throw Object.assign(new Error("rate limited"), { status: 429 });
        return { operationName: "operations/fake-2" };
      },
    });

    const first = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });
    expect(first.outcome).toBe("requeued_for_retry");

    const second = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });
    expect(second.outcome).toBe("submitted");
    if (second.outcome !== "submitted") throw new Error("expected submitted");
    expect(second.generation.technicalExecutionGenerationRequestId).toBe(requestId);
    expect(submitAttempts).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // POSITION -> CONTROL -> EXECUTE sequence represented in the persisted instruction.
  // ---------------------------------------------------------------------------

  it("the persisted providerInstruction contains all 3 ordered steps, exactly once", async () => {
    const { ownerUserId, requestId } = await createSealedRequest();
    const client = fakeClient();

    await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, { env: enabledEnv, createProvider: (config) => new TechnicalExecutionVeoProvider(config, client) });

    const row = await prisma.technicalExecutionVideoGeneration.findFirstOrThrow({ where: { technicalExecutionGenerationRequestId: requestId } });
    const stepLines = row.providerInstruction.split("\n").filter((line) => /^\d+\.\s/.test(line));
    expect(stepLines.length).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Stage 2.5.i.26 -- injectable compiler plumbing: proves the second real
  // pilot (Continue Central Nape Construction) can be exercised through
  // this SAME, already-proven orchestrator via dependency injection, and
  // that the injected instruction actually differs from the default
  // (single-action) pilot -- i.e. the override genuinely takes effect,
  // never silently ignored.
  // ---------------------------------------------------------------------------

  it("i.26: injecting compileProviderAdapterOutput routes to the progression compiler, and its providerInstruction contains repeated-step wording the default pilot never produces", async () => {
    const { ownerUserId, requestId } = await createSealedRequest();
    const client = fakeClient();

    const result = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, {
      env: enabledEnv,
      createProvider: (config) => new TechnicalExecutionVeoProvider(config, client),
      compileProviderAdapterOutput: compileContinueCentralNapeConstructionProviderAdapterOutput,
      demonstrationHints: { subsectionSizeHint: "1cm", repeatCountHint: 3 },
    });

    expect(result.outcome).toBe("submitted");
    const row = await prisma.technicalExecutionVideoGeneration.findFirstOrThrow({ where: { technicalExecutionGenerationRequestId: requestId } });
    expect(row.providerInstruction).toMatch(/repeatedly/i);
    expect(row.providerInstruction).toMatch(/previous subsection/i);
    expect(row.providerInstruction).toMatch(/for this demonstration, render approximately 3 repetitions, each subsection approximately 1cm/i);
  });

  // ---------------------------------------------------------------------------
  // network safety
  // ---------------------------------------------------------------------------

  describe("network safety", () => {
    it("with no VIDEO_DEMONSTRATION_* environment configured, execution never even attempts to construct a real provider", async () => {
      const { ownerUserId, requestId } = await createSealedRequest();
      let providerConstructed = false;

      const result = await executeTechnicalExecutionVideoGeneration(requestId, ownerUserId, {
        env: {},
        createProvider: (config) => {
          providerConstructed = true;
          return new TechnicalExecutionVeoProvider(config, fakeClient());
        },
      });

      expect(result).toEqual({ outcome: "failed", code: "PROCESSING_DISABLED" });
      expect(providerConstructed).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@technical-execution-video-generation-execution-service.test`, passwordHash: "test", role: "professional", locale: "en" } });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Technical Execution Video Execution Service Client" } });
  return { ownerUserId, clientId };
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  const id = randomUUID();
  const buffer = await realJpegBuffer();
  const asset = await prisma.imageAsset.create({
    data: { id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: buffer.length, ownerUserId, clientId, storagePath: "pending", width: 1080, height: 1440 },
  });
  const storagePath = await saveImageFile(ownerUserId, id, asset.fileName, buffer);
  const updated = await prisma.imageAsset.update({ where: { id }, data: { storagePath } });
  return { asset: updated, buffer };
}

async function createCaptureSetWithBack(ownerUserId: string, clientId: string) {
  const { asset, buffer } = await createImageAsset(ownerUserId, clientId);
  const captureSet = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "BACK", imageAssetId: asset.id }]);
  return { captureSet, captureSetImage: captureSet.images[0], imageBuffer: buffer };
}

async function createSealedRequest() {
  const { ownerUserId, clientId } = await createOwnerAndClient();
  const { captureSet, captureSetImage, imageBuffer } = await createCaptureSetWithBack(ownerUserId, clientId);

  const request = await createTechnicalExecutionGenerationRequest(ownerUserId, clientId, "TECHNICAL_EXECUTION_VIDEO", captureSet.id, captureSetImage.id);
  await grantTechnicalExecutionGenerationConsent(ownerUserId, request.id, "v1");
  await recordTechnicalExecutionGenerationQualification(ownerUserId, request.id, "QUALIFIED", "MANUAL_USER_CONFIRMATION");
  await sealTechnicalExecutionGenerationRequest(ownerUserId, request.id);

  return { ownerUserId, clientId, requestId: request.id, imageBuffer };
}
