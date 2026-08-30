import { describe, expect, it, vi } from "vitest";

import { GeminiPhotoPreviewProvider, type GeminiGenerateImageClient } from "@/lib/photo-preview-provider-gemini";
import { buildSealedPhotoPreviewRequest, type BuildSealedPhotoPreviewRequestInput } from "@/lib/photo-preview-contracts";

// Real AI Photo Preview, Stage 2 -- the Gemini adapter's own request/
// response handling, tested entirely against a hand-built fake client
// (GeminiGenerateImageClient) -- ZERO network calls, matching this
// repository's own "no mocking library, hand-built fakes at I/O
// boundaries" convention exactly. This file NEVER constructs the real
// `createDefaultGeminiImageClient` -- that function is not imported here
// at all, so it is structurally impossible for these tests to reach the
// network (task §38's own hard acceptance condition).

// A real, valid sealed request -- the adapter genuinely calls the real
// instruction assembler internally, so an empty stub would fail before
// ever reaching the client (this is real fixture data, not a mock).
const fakeSealedRequestInput: BuildSealedPhotoPreviewRequestInput = {
  sourceImage: { assetId: "asset-1", width: 1080, height: 1440, orientation: 0, contentSha256: null, storageVersionId: null },
  viewLabel: "front",
  target: {
    globalIntent: {
      structuralTechnique: "graduation",
      cuttingTechnique: "slice_cutting",
      sectioning: "diagonal_back",
      elevation: "45_deg_graduation",
      distribution: "overdirected_back",
      guideline: "stationary",
    },
    zones: [],
    relationships: [],
  },
  spatial: {
    zones: (["crown", "occipital", "nape", "top", "sides", "fringe"] as const).map((zone) => ({ zone, state: "not_placed" as const })),
    perimeter: { state: "not_placed" },
  },
  mapPreserveConstraints: [],
  contraindications: [],
};
const fakeSealedRequest = buildSealedPhotoPreviewRequest(fakeSealedRequestInput);
const fakeSourceImage = { buffer: Buffer.from("source-bytes"), mimeType: "image/jpeg" };
const validApiKey = "test-key";
const validModel = "gemini-3.1-flash-image";

function fakeClient(result: Partial<Awaited<ReturnType<GeminiGenerateImageClient["generateImage"]>>> = {}): GeminiGenerateImageClient {
  return {
    generateImage: vi.fn().mockResolvedValue({
      imageBase64: Buffer.from("generated-bytes").toString("base64"),
      imageMimeType: "image/png",
      finishReason: "STOP",
      blockReason: undefined,
      ...result,
    }),
  };
}

describe("GeminiPhotoPreviewProvider", () => {
  it("requires an API key and a model, fails closed with NOT_CONFIGURED otherwise", () => {
    expect(() => new GeminiPhotoPreviewProvider({ apiKey: "", model: validModel })).toThrow();
    expect(() => new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: "" })).toThrow();
  });

  it("14. sends the source image and the assembled instruction to the client, uses the configured model only", async () => {
    const client = fakeClient();
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, client);

    await provider.generate(fakeSealedRequest, fakeSourceImage);

    expect(client.generateImage).toHaveBeenCalledTimes(1);
    const call = (client.generateImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe(validModel);
    expect(call.imageBase64).toBe(fakeSourceImage.buffer.toString("base64"));
    expect(call.mimeType).toBe("image/jpeg");
    expect(typeof call.instruction).toBe("string");
    expect(call.instruction.length).toBeGreaterThan(0);
  });

  it("returns the generated image bytes on a valid, image-bearing response", async () => {
    const client = fakeClient({ imageBase64: Buffer.from("real-image").toString("base64"), imageMimeType: "image/png" });
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, client);

    const outcome = await provider.generate(fakeSealedRequest, fakeSourceImage);

    expect(outcome.imageBuffer).toEqual(Buffer.from("real-image"));
    expect(outcome.mimeType).toBe("image/png");
  });

  it("16. rejects a response with no image part -- never assumes an image was returned", async () => {
    const client = fakeClient({ imageBase64: undefined, imageMimeType: undefined });
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, client);

    const error = await provider.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe("INVALID_RESPONSE");
  });

  it("15. rejects a moderation-blocked response as a distinct, non-retryable refusal", async () => {
    const client = fakeClient({ blockReason: "SAFETY", imageBase64: undefined, imageMimeType: undefined });
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, client);

    const error = await provider.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe("MODERATION_REFUSED");
    expect((error as { retryable?: boolean }).retryable).toBe(false);
  });

  it("rejects a non-STOP finishReason (e.g. blocked mid-generation) as a refusal too", async () => {
    const client = fakeClient({ finishReason: "PROHIBITED_CONTENT", imageBase64: undefined, imageMimeType: undefined });
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, client);

    const error = await provider.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe("MODERATION_REFUSED");
  });

  it("classifies a timeout (aborted signal) as TIMEOUT, retryable", async () => {
    const client: GeminiGenerateImageClient = {
      generateImage: vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }),
    };
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel, timeoutMs: 5 }, client);

    const error = await provider.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe("TIMEOUT");
    expect((error as { retryable?: boolean }).retryable).toBe(true);
  });

  it("classifies a 429 as RATE_LIMITED, retryable", async () => {
    const client: GeminiGenerateImageClient = { generateImage: vi.fn().mockRejectedValue({ status: 429 }) };
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, client);

    const error = await provider.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe("RATE_LIMITED");
    expect((error as { retryable?: boolean }).retryable).toBe(true);
  });

  it("classifies a 500 as PROVIDER_ERROR, retryable; a 401 as NOT_CONFIGURED, not retryable", async () => {
    const serverErrorClient: GeminiGenerateImageClient = { generateImage: vi.fn().mockRejectedValue({ status: 500 }) };
    const provider1 = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, serverErrorClient);
    const error1 = await provider1.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect((error1 as { code?: string }).code).toBe("PROVIDER_ERROR");
    expect((error1 as { retryable?: boolean }).retryable).toBe(true);

    const authErrorClient: GeminiGenerateImageClient = { generateImage: vi.fn().mockRejectedValue({ status: 401 }) };
    const provider2 = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, authErrorClient);
    const error2 = await provider2.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect((error2 as { code?: string }).code).toBe("NOT_CONFIGURED");
    expect((error2 as { retryable?: boolean }).retryable).toBe(false);
  });

  it("captures real usage metadata and the provider's own response id when present", async () => {
    const client: GeminiGenerateImageClient = {
      generateImage: vi.fn().mockImplementation(async ({ onUsage }) => {
        onUsage?.({ promptTokenCount: 500, candidatesTokenCount: 1290, totalTokenCount: 1790 }, "resp-abc");
        return { imageBase64: Buffer.from("x").toString("base64"), imageMimeType: "image/png", finishReason: "STOP", blockReason: undefined };
      }),
    };
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, client);

    const outcome = await provider.generate(fakeSealedRequest, fakeSourceImage);
    expect(outcome.providerRequestId).toBe("resp-abc");
    expect(outcome.usage).toEqual({ inputTokens: 500, outputTokens: 1290, totalTokens: 1790, imageCount: 1 });
  });

  it("never fabricates usage when Gemini reports none, but still counts the image", async () => {
    const client = fakeClient();
    const provider = new GeminiPhotoPreviewProvider({ apiKey: validApiKey, model: validModel }, client);
    const outcome = await provider.generate(fakeSealedRequest, fakeSourceImage);
    expect(outcome.usage).toEqual({ imageCount: 1 });
  });
});
