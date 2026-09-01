import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, vi } from "vitest";

import type { SealedVideoDemonstrationRequest } from "@/lib/video-generation-contracts";
import { VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS, VeoVideoDemonstrationProvider, type VeoPollResult, type VeoSubmitResult, type VeoVideoGenerationClient } from "@/lib/video-provider-veo";

// Real AI Video Demonstration, Stage 2 -- fills a real Stage 1 coverage
// gap: VeoVideoDemonstrationProvider's OWN classification/parsing logic
// (given an injected fake VeoVideoGenerationClient) was never independently
// tested, only its untestable-by-design real network glue
// (createDefaultVeoClient) was ever exercised (never, deliberately -- see
// video-generation-execution-service.test.ts's own "network safety" test).
// Every test in this file injects an explicit fake client -- the
// constructor's second, optional parameter -- so createDefaultVeoClient
// (and therefore any real network call) is NEVER reached here either.

const SEALED_REQUEST: SealedVideoDemonstrationRequest = {
  schemaVersion: "1.0.0",
  sourceImage: { assetId: "asset-1", mimeType: "image/png", contentSha256: null },
  viewLabel: "front",
  targetSummary: { structuralTechnique: "graduation" },
  preserveContract: { invariants: ["preserve_identity"] },
};
const SOURCE_IMAGE = { buffer: Buffer.from("fake-image-bytes"), mimeType: "image/png" };

function fakeClient(overrides: Partial<VeoVideoGenerationClient> = {}): VeoVideoGenerationClient {
  return {
    submit: vi.fn().mockResolvedValue({ operationName: "op-1" } satisfies VeoSubmitResult),
    poll: vi.fn().mockResolvedValue({ done: false, errorMessage: undefined, videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined } satisfies VeoPollResult),
    ...overrides,
  };
}

function provider(client: VeoVideoGenerationClient) {
  return new VeoVideoDemonstrationProvider({ apiKey: "test-key", model: "veo-3.1-lite-generate-preview" }, client);
}

describe("VeoVideoDemonstrationProvider.submit", () => {
  it("returns the real providerOperationId on success", async () => {
    const client = fakeClient({ submit: vi.fn().mockResolvedValue({ operationName: "operations/abc123" }) });
    const outcome = await provider(client).submit(SEALED_REQUEST, SOURCE_IMAGE);
    expect(outcome).toEqual({ providerOperationId: "operations/abc123" });
  });

  it("throws INVALID_RESPONSE when the client returns no usable operation identity -- never a silently empty operation id", async () => {
    const client = fakeClient({ submit: vi.fn().mockResolvedValue({ operationName: undefined }) });
    await expect(provider(client).submit(SEALED_REQUEST, SOURCE_IMAGE)).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
  });

  it("passes the sealed request through the real instruction assembler and the source image bytes as base64 -- never a raw/browser prompt", async () => {
    const submit = vi.fn().mockResolvedValue({ operationName: "op-1" });
    await provider(fakeClient({ submit })).submit(SEALED_REQUEST, SOURCE_IMAGE);
    expect(submit).toHaveBeenCalledTimes(1);
    const call = submit.mock.calls[0][0];
    expect(typeof call.instruction).toBe("string");
    expect(call.instruction.length).toBeGreaterThan(0);
    expect(call.imageBase64).toBe(SOURCE_IMAGE.buffer.toString("base64"));
    expect(call.mimeType).toBe("image/png");
    expect(call.model).toBe("veo-3.1-lite-generate-preview");
  });

  it("classifies a 401/403 as NOT_CONFIGURED, 429 as RATE_LIMITED (retryable), 5xx as PROVIDER_ERROR (retryable), other 4xx as PROVIDER_ERROR (non-retryable)", async () => {
    async function submitWithStatus(status: number) {
      const client = fakeClient({ submit: vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { status })) });
      return provider(client)
        .submit(SEALED_REQUEST, SOURCE_IMAGE)
        .catch((e) => e);
    }
    expect(await submitWithStatus(401)).toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
    expect(await submitWithStatus(429)).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(await submitWithStatus(503)).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
    expect(await submitWithStatus(400)).toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
  });

  it("a real submit timeout (abort) is classified TIMEOUT, retryable", async () => {
    const client = fakeClient({
      submit: vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      })),
    });
    const timedProvider = new VeoVideoDemonstrationProvider({ apiKey: "k", model: "veo-3.1-lite-generate-preview", timeoutMs: 5 }, client);
    await expect(timedProvider.submit(SEALED_REQUEST, SOURCE_IMAGE)).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });
});

describe("VeoVideoDemonstrationProvider.poll", () => {
  it("returns {done:false} while the operation is still processing", async () => {
    const outcome = await provider(fakeClient()).poll("op-1");
    expect(outcome).toEqual({ done: false });
  });

  it("returns real video bytes + mimeType + the requested (not provider-confirmed) duration on a successful completion", async () => {
    const bytes = Buffer.from("real video bytes");
    const client = fakeClient({ poll: vi.fn().mockResolvedValue({ done: true, errorMessage: undefined, videoUri: undefined, videoBytesBase64: bytes.toString("base64"), videoMimeType: "video/mp4" }) });
    const outcome = await provider(client).poll("op-1");
    expect(outcome.done).toBe(true);
    if (!outcome.done) throw new Error("expected done");
    expect(outcome.videoBuffer.equals(bytes)).toBe(true);
    expect(outcome.mimeType).toBe("video/mp4");
    expect(outcome.durationSeconds).toBe(VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS);
  });

  it("defaults mimeType to video/mp4 when the client reports none", async () => {
    const client = fakeClient({ poll: vi.fn().mockResolvedValue({ done: true, errorMessage: undefined, videoUri: undefined, videoBytesBase64: Buffer.from("x").toString("base64"), videoMimeType: undefined }) });
    const outcome = await provider(client).poll("op-1");
    if (!outcome.done) throw new Error("expected done");
    expect(outcome.mimeType).toBe("video/mp4");
  });

  it("throws MODERATION_REFUSED, non-retryable, when the client reports a terminal errorMessage", async () => {
    const client = fakeClient({ poll: vi.fn().mockResolvedValue({ done: true, errorMessage: "blocked by safety filters", videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined }) });
    await expect(provider(client).poll("op-1")).rejects.toMatchObject({ code: "MODERATION_REFUSED", retryable: false });
  });

  it("a malformed completed result (done:true, no bytes, no uri, no error) is INVALID_RESPONSE, never silently treated as success", async () => {
    const client = fakeClient({ poll: vi.fn().mockResolvedValue({ done: true, errorMessage: undefined, videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined }) });
    await expect(provider(client).poll("op-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
  });

  it("a completed result with a URI but the client failing to resolve usable bytes for it is also INVALID_RESPONSE -- never fabricates bytes", async () => {
    // Mirrors what a broken/incomplete client implementation would look
    // like -- createDefaultVeoClient's REAL implementation always resolves
    // videoBytesBase64 itself before returning (Stage 2's own download
    // fix); this proves the outer classification still fails closed if a
    // client implementation ever regresses that guarantee.
    const client = fakeClient({ poll: vi.fn().mockResolvedValue({ done: true, errorMessage: undefined, videoUri: "https://example.invalid/video.mp4", videoBytesBase64: undefined, videoMimeType: undefined }) });
    await expect(provider(client).poll("op-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
  });

  it("a download/network failure during poll (e.g. an expired provider URI) is classified as a real provider failure, never silently treated as still-processing or success", async () => {
    const client = fakeClient({ poll: vi.fn().mockRejectedValue(Object.assign(new Error("uri expired"), { status: 404 })) });
    await expect(provider(client).poll("op-1")).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND", retryable: false });
  });

  it("classifies a 429 poll failure as RATE_LIMITED (retryable) and a 5xx as PROVIDER_ERROR (retryable)", async () => {
    const rateLimited = fakeClient({ poll: vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { status: 429 })) });
    await expect(provider(rateLimited).poll("op-1")).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    const serverError = fakeClient({ poll: vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { status: 500 })) });
    await expect(provider(serverError).poll("op-1")).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("a real poll timeout (abort) is classified TIMEOUT, retryable", async () => {
    const client = fakeClient({
      poll: vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      })),
    });
    const timedProvider = new VeoVideoDemonstrationProvider({ apiKey: "k", model: "veo-3.1-lite-generate-preview", timeoutMs: 5 }, client);
    await expect(timedProvider.poll("op-1")).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("passes the exact providerOperationId through to the client, never transformed", async () => {
    const poll = vi.fn().mockResolvedValue({ done: false, errorMessage: undefined, videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined });
    await provider(fakeClient({ poll })).poll("operations/exact-value-123");
    expect(poll).toHaveBeenCalledWith(expect.objectContaining({ operationName: "operations/exact-value-123" }));
  });
});

describe("construction", () => {
  it("requires a non-empty apiKey and model -- fails closed rather than constructing a half-configured provider", () => {
    expect(() => new VeoVideoDemonstrationProvider({ apiKey: "", model: "veo-3.1-lite-generate-preview" }, fakeClient())).toThrow();
    expect(() => new VeoVideoDemonstrationProvider({ apiKey: "k", model: "" }, fakeClient())).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Real-test fix (2026-09-01): the first (and only) authorized real Veo
// submit failed in ~24ms, before any providerOperationId was ever
// produced -- the server's own log showed the installed SDK's runtime
// deprecation warning for the flat prompt/image call shape. Fixed by
// nesting under `source`. createDefaultVeoClient (the real network glue)
// is deliberately never exercised by any test in this file (see the
// header comment) -- there is no injectable seam for it, and adding one
// would be an architecture change this fix does not authorize. This is
// therefore a source-level regression lock, mirroring the exact same
// precedent already established in this codebase for another
// untested-by-design network boundary
// (image-assets/[id]/content/route.test.ts's own "does not implement
// range/partial-content support (source-level check)" test).
// ---------------------------------------------------------------------------

describe("real Veo request shape (source-level regression lock -- no network call, no injectable seam exists for createDefaultVeoClient)", () => {
  function readSourceFile(): string {
    return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "video-provider-veo.ts"), "utf8");
  }

  it("generateVideos() is called with the nested `source: { prompt, image }` shape, not the deprecated flat prompt/image arguments", () => {
    const source = readSourceFile();
    // The exact call shape: `model,` immediately followed by `source: {` --
    // only matches the fixed form, never the old flat one.
    expect(source).toMatch(/generateVideos\(\{\s*model,\s*source:\s*\{/);
  });

  it("the deprecated flat call shape (image/prompt as direct siblings of model) is never reintroduced", () => {
    const source = readSourceFile();
    // The old, broken shape had `model,` directly followed by `image: {`
    // -- assert that exact sequence is absent.
    expect(source).not.toMatch(/generateVideos\(\{\s*model,\s*image:\s*\{/);
  });

  it("source.prompt receives the assembled instruction, and source.image receives the base64 bytes + mimeType in the SDK's own Image shape", () => {
    const source = readSourceFile();
    expect(source).toMatch(/source:\s*\{\s*image:\s*\{\s*imageBytes:\s*imageBase64,\s*mimeType\s*\},\s*prompt:\s*instruction\s*\}/);
  });

  it("config (aspectRatio/personGeneration/durationSeconds) stays a top-level sibling of source, untouched by the shape fix", () => {
    const source = readSourceFile();
    // `source` (nested braces included) must appear, in file order, before
    // `config:` -- a plain index comparison rather than a brace-counting
    // regex, since source's own value is itself a nested object.
    const sourceIndex = source.indexOf("source: { image:");
    const configIndex = source.indexOf("config: {", sourceIndex);
    expect(sourceIndex).toBeGreaterThan(-1);
    expect(configIndex).toBeGreaterThan(sourceIndex);
    expect(source).toContain('aspectRatio: "9:16"');
    expect(source).toContain('personGeneration: "allow_adult"');
    expect(source).toContain("durationSeconds: VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS");
  });

  // Real-test fix #2 (root-cause diagnostic, 2026-09-01): the installed SDK
  // (node_modules/@google/genai/dist/node/index.cjs,
  // generateVideosConfigToMldev) throws LOCALLY, before any network request,
  // the instant `generateAudio` is present in config at all (true OR false
  // both count -- the check is `!== undefined`), because this adapter never
  // sets vertexai:true and Gemini Developer API mode does not support that
  // field. `generateAudio: false` used to be hardcoded here; this lock
  // proves it can never silently come back.
  it("config never includes `generateAudio` (Gemini Developer API mode rejects it locally, regardless of true/false)", () => {
    const source = readSourceFile();
    const sourceIndex = source.indexOf("source: { image:");
    const configIndex = source.indexOf("config: {", sourceIndex);
    const configEndIndex = source.indexOf("});", configIndex);
    const configBlock = source.slice(configIndex, configEndIndex);
    expect(configBlock).not.toMatch(/generateAudio/);
  });

  // Same fact, proven dynamically against the real, unmodified, installed
  // SDK's own local validation logic -- not just a regex over our source.
  // Network safety here does NOT rely on reasoning about the SDK's call
  // order: global fetch (confirmed, by direct inspection of the installed
  // SDK's own compiled source, to be exactly what its ApiClient.request()
  // calls) is stubbed to immediately reject before this test ever runs the
  // real generateVideos() -- so even if our fixed config passes the SDK's
  // local generateAudio validation and execution proceeds toward building a
  // real HTTP request, it can never leave this process; it will always hit
  // the stub instead of a real socket, for any code path this fix could
  // possibly touch.
  it("dynamically: our exact config shape (without generateAudio) does not trigger the SDK's own 'generateAudio ... not in Gemini Developer API mode' throw", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("BLOCKED_FOR_TEST_NO_REAL_NETWORK_CALL_PERMITTED");
    }) as typeof fetch;

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: "not-a-real-key-never-sent" });
      const ourConfig = {
        aspectRatio: "9:16" as const,
        personGeneration: "allow_adult" as const,
        durationSeconds: VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS,
      };

      let caught: unknown;
      try {
        await ai.models.generateVideos({
          model: "veo-3.1-lite-generate-preview",
          source: { image: { imageBytes: "not-real-image-bytes", mimeType: "image/png" }, prompt: "test" },
          config: ourConfig,
        });
      } catch (error) {
        caught = error;
      }

      // The call must fail (fetch is stubbed to always reject) -- but via
      // OUR stub's own error, never the SDK's local generateAudio message.
      // Reaching the stub at all is itself proof execution got past the
      // local config validation this fix targets.
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("BLOCKED_FOR_TEST_NO_REAL_NETWORK_CALL_PERMITTED");
      expect((caught as Error).message).not.toMatch(/generateAudio/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
