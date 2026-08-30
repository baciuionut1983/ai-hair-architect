import { describe, expect, it } from "vitest";

import {
  AlwaysFailingPhotoPreviewProvider,
  FakePhotoPreviewProvider,
  GeminiPhotoPreviewProviderSkeleton,
  getPhotoPreviewProvider,
} from "@/lib/photo-preview-provider";
import type { SealedPhotoPreviewRequest } from "@/lib/photo-preview-contracts";

// Real AI Photo Preview, Stage 1 -- pure, no network, no real provider call.
// Every test here proves the provider BOUNDARY behaves correctly; none of
// them can accidentally reach a real Gemini/OpenAI endpoint (no SDK is even
// imported by photo-preview-provider.ts).

const fakeSealedRequest = {} as SealedPhotoPreviewRequest; // opaque to these tests -- only the boundary shape matters here
const fakeSourceImage = { buffer: Buffer.from("fake-bytes"), mimeType: "image/jpeg" };

describe("FakePhotoPreviewProvider", () => {
  it("returns a successful outcome without making any network call", async () => {
    const provider = new FakePhotoPreviewProvider();
    const outcome = await provider.generate(fakeSealedRequest, fakeSourceImage);
    expect(outcome.imageBuffer).toEqual(fakeSourceImage.buffer);
    expect(outcome.mimeType).toBe("image/jpeg");
    expect(outcome.providerRequestId).toBeDefined();
    expect(outcome.usage).toEqual({ imageCount: 1 });
  });
});

describe("AlwaysFailingPhotoPreviewProvider", () => {
  it("always throws a typed PhotoPreviewProviderError", async () => {
    const provider = new AlwaysFailingPhotoPreviewProvider();
    const error = await provider.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe("PROVIDER_ERROR");
    expect((error as { retryable?: boolean }).retryable).toBe(true);
  });
});

describe("GeminiPhotoPreviewProviderSkeleton", () => {
  it("structurally exists (correct name/modelVersion) but generate() always throws NOT_IMPLEMENTED -- Stage 1 makes zero real provider calls", async () => {
    const provider = new GeminiPhotoPreviewProviderSkeleton("gemini-3.1-flash-image");
    expect(provider.name).toBe("gemini");
    expect(provider.modelVersion).toBe("gemini-3.1-flash-image");

    const error = await provider.generate(fakeSealedRequest, fakeSourceImage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe("NOT_IMPLEMENTED");
    expect((error as { retryable?: boolean }).retryable).toBe(false);
  });
});

describe("getPhotoPreviewProvider", () => {
  it("resolves 'gemini' to the non-network skeleton, carrying the requested model version", () => {
    const provider = getPhotoPreviewProvider("gemini", "gemini-3-pro-image");
    expect(provider).toBeInstanceOf(GeminiPhotoPreviewProviderSkeleton);
    expect(provider.modelVersion).toBe("gemini-3-pro-image");
  });

  it("resolves 'fake-deterministic' to the fake provider", () => {
    expect(getPhotoPreviewProvider("fake-deterministic", "n/a")).toBeInstanceOf(FakePhotoPreviewProvider);
  });

  it("an unrecognized or absent provider name fails closed to the fake provider, never to a real network client", () => {
    expect(getPhotoPreviewProvider(undefined, "n/a")).toBeInstanceOf(FakePhotoPreviewProvider);
    expect(getPhotoPreviewProvider("something-unexpected", "n/a")).toBeInstanceOf(FakePhotoPreviewProvider);
  });
});
