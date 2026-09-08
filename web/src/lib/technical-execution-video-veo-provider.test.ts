import { describe, expect, it } from "vitest";

import { TechnicalExecutionVeoProvider } from "@/lib/technical-execution-video-veo-provider";
import type { VeoPollResult, VeoSubmitResult, VeoVideoGenerationClient } from "@/lib/video-provider-veo";
import type { VideoDemonstrationProviderError } from "@/lib/video-provider";

// AI Hair Architect, Stage 2.5.i.23 -- TECHNICAL EXECUTION VIDEO, VEO
// PROVIDER CALLER TESTS. Every test constructs TechnicalExecutionVeoProvider
// with an explicit FAKE client -- the real (default) client construction
// path (createDefaultVeoClient, which makes a real, billable network call)
// is never exercised by any test in this file. This mirrors
// video-provider-veo.ts's own "network safety" precedent exactly.

function fakeClient(overrides: Partial<VeoVideoGenerationClient> = {}): VeoVideoGenerationClient {
  return {
    submit: async (): Promise<VeoSubmitResult> => ({ operationName: "operations/fake-1" }),
    poll: async (): Promise<VeoPollResult> => ({ done: true, errorMessage: undefined, videoUri: undefined, videoBytesBase64: Buffer.from("fake").toString("base64"), videoMimeType: "video/mp4" }),
    ...overrides,
  };
}

const SOURCE_IMAGE = { buffer: Buffer.from("fake image bytes"), mimeType: "image/jpeg" };

describe("TechnicalExecutionVeoProvider", () => {
  it("A. throws NOT_CONFIGURED when apiKey is empty", () => {
    expect(() => new TechnicalExecutionVeoProvider({ apiKey: "", model: "veo-3.1-lite-generate-preview" })).toThrow();
  });

  it("B. throws NOT_CONFIGURED when model is empty", () => {
    expect(() => new TechnicalExecutionVeoProvider({ apiKey: "key", model: "" })).toThrow();
  });

  it("C. submit() passes the instruction, image bytes/mimeType, and model through verbatim to the client", async () => {
    let received: Parameters<VeoVideoGenerationClient["submit"]>[0] | undefined;
    const client = fakeClient({
      submit: async (input) => {
        received = input;
        return { operationName: "operations/real-1" };
      },
    });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "veo-3.1-lite-generate-preview" }, client);

    const outcome = await provider.submit("EXACT INSTRUCTION TEXT", SOURCE_IMAGE);

    expect(outcome.providerOperationId).toBe("operations/real-1");
    expect(received?.instruction).toBe("EXACT INSTRUCTION TEXT");
    expect(received?.imageBase64).toBe(SOURCE_IMAGE.buffer.toString("base64"));
    expect(received?.mimeType).toBe("image/jpeg");
    expect(received?.model).toBe("veo-3.1-lite-generate-preview");
  });

  it("D. submit() throws INVALID_RESPONSE when the client returns no operation name", async () => {
    const client = fakeClient({ submit: async () => ({ operationName: undefined }) });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    await expect(provider.submit("i", SOURCE_IMAGE)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("E. poll() returns done:false while the client reports not done", async () => {
    const client = fakeClient({ poll: async () => ({ done: false, errorMessage: undefined, videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined }) });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    const outcome = await provider.poll("op-1");
    expect(outcome.done).toBe(false);
  });

  it("F. poll() returns a real video buffer + requested duration on success", async () => {
    const client = fakeClient();
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    const outcome = await provider.poll("op-1");
    expect(outcome.done).toBe(true);
    if (outcome.done) {
      expect(outcome.videoBuffer.toString()).toBe("fake");
      expect(outcome.mimeType).toBe("video/mp4");
      expect(outcome.durationSeconds).toBe(6);
    }
  });

  it("G. poll() throws MODERATION_REFUSED when the client reports a terminal error message", async () => {
    const client = fakeClient({ poll: async () => ({ done: true, errorMessage: "blocked", videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined }) });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    await expect(provider.poll("op-1")).rejects.toMatchObject({ code: "MODERATION_REFUSED", retryable: false });
  });

  it("H. poll() throws INVALID_RESPONSE when done but no usable video bytes exist", async () => {
    const client = fakeClient({ poll: async () => ({ done: true, errorMessage: undefined, videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined }) });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    await expect(provider.poll("op-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("I. classifies HTTP 429 as RATE_LIMITED, retryable", async () => {
    const err = Object.assign(new Error("rate"), { status: 429 });
    const client = fakeClient({ submit: async () => { throw err; } });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    await expect(provider.submit("i", SOURCE_IMAGE)).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("J. classifies HTTP 401/403 as NOT_CONFIGURED, non-retryable", async () => {
    const err = Object.assign(new Error("auth"), { status: 401 });
    const client = fakeClient({ submit: async () => { throw err; } });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    await expect(provider.submit("i", SOURCE_IMAGE)).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
  });

  it("K. classifies HTTP 5xx as PROVIDER_ERROR, retryable", async () => {
    const err = Object.assign(new Error("down"), { status: 503 });
    const client = fakeClient({ poll: async () => { throw err; } });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    await expect(provider.poll("op-1")).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("L. an already-classified VideoDemonstrationProviderError thrown by the client passes through unchanged", async () => {
    const original = Object.assign(new Error("already classified"), { code: "OPERATION_NOT_FOUND" as const, retryable: false }) satisfies VideoDemonstrationProviderError;
    const client = fakeClient({ poll: async () => { throw original; } });
    const provider = new TechnicalExecutionVeoProvider({ apiKey: "key", model: "m" }, client);
    await expect(provider.poll("op-1")).rejects.toBe(original);
  });
});
