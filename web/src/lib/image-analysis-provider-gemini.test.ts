import { describe, expect, it } from "vitest";

import {
  GEMINI_DEFAULT_TIMEOUT_MS,
  GEMINI_PROVIDER_NAME,
  GeminiImageAnalysisProvider,
  type GeminiGenerateContentClient,
  type GeminiGenerateContentInput,
} from "./image-analysis-provider-gemini";
import type { ProviderError } from "./image-analysis-provider";

const VALID_RESPONSE = JSON.stringify({
  hairType: "curly",
  density: "high",
  porosity: "medium",
  confidences: { hairType: 0.91, density: 0.82, porosity: 0.77 },
});

function analysisOptions() {
  return {
    imageBuffer: Buffer.from("fake-image-bytes"),
    mimeType: "image/jpeg",
    userId: "user-1",
    clientId: "client-1",
  };
}

function fixedClient(text: string | undefined): GeminiGenerateContentClient {
  return { async generateContent() { return text; } };
}

function rejectingClient(error: unknown): GeminiGenerateContentClient {
  return { async generateContent() { throw error; } };
}

function recordingClient(sink: { input?: GeminiGenerateContentInput }, text: string): GeminiGenerateContentClient {
  return {
    async generateContent(input) {
      sink.input = input;
      return text;
    },
  };
}

function hangingUntilAbortedClient(): GeminiGenerateContentClient {
  return {
    generateContent({ signal }) {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    },
  };
}

function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function isProviderError(error: unknown): error is ProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

describe("GeminiImageAnalysisProvider", () => {
  it("fails closed synchronously on invalid configuration (empty api key / model)", () => {
    expect(() => new GeminiImageAnalysisProvider({ apiKey: "", model: "gemini-3.6-flash" }, fixedClient(VALID_RESPONSE)))
      .toThrow();
    expect(() => new GeminiImageAnalysisProvider({ apiKey: "key", model: "" }, fixedClient(VALID_RESPONSE)))
      .toThrow();

    try {
      new GeminiImageAnalysisProvider({ apiKey: "", model: "gemini-3.6-flash" }, fixedClient(VALID_RESPONSE));
      expect.unreachable();
    } catch (error) {
      expect(isProviderError(error)).toBe(true);
      if (isProviderError(error)) {
        expect(error.code).toBe("NOT_CONFIGURED");
      }
    }
  });

  it("exposes the expected name and model version", () => {
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(VALID_RESPONSE));
    expect(provider.name).toBe(GEMINI_PROVIDER_NAME);
    expect(provider.modelVersion).toBe("gemini-3.6-flash");
  });

  it("parses a valid structured response into the exactly-3-field MVP contract", async () => {
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(VALID_RESPONSE));

    const outcome = await provider.analyze(analysisOptions());

    expect(outcome.result).toEqual({
      hairType: "curly",
      density: "high",
      porosity: "medium",
      faceShape: null,
      headShape: null,
      hairLength: null,
      hairTexture: null,
      hairCondition: null,
      growthPattern: null,
      targetShape: null,
    });
    expect(outcome.confidences).toEqual({
      hairType: 0.91,
      density: 0.82,
      porosity: 0.77,
      faceShape: 0,
      headShape: 0,
      hairLength: 0,
      hairTexture: 0,
      hairCondition: 0,
      growthPattern: 0,
      targetShape: 0,
    });
    expect(outcome.warnings.length).toBeGreaterThan(0);
    expect(outcome.limitations.length).toBeGreaterThan(0);
  });

  it("parsing is deterministic: the same response always maps to the same structured output", async () => {
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(VALID_RESPONSE));

    const first = await provider.analyze(analysisOptions());
    const second = await provider.analyze(analysisOptions());

    expect(first).toEqual(second);
  });

  it("sends the image as base64 inline data along with the configured model", async () => {
    const sink: { input?: GeminiGenerateContentInput } = {};
    const provider = new GeminiImageAnalysisProvider(
      { apiKey: "key", model: "gemini-3.6-flash" },
      recordingClient(sink, VALID_RESPONSE),
    );

    await provider.analyze(analysisOptions());

    expect(sink.input?.model).toBe("gemini-3.6-flash");
    expect(sink.input?.mimeType).toBe("image/jpeg");
    expect(sink.input?.imageBase64).toBe(Buffer.from("fake-image-bytes").toString("base64"));
  });

  it("rejects malformed JSON as INVALID_FORMAT without leaking the raw response text", async () => {
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient("not-json-at-all-secret-marker"));

    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "INVALID_FORMAT", retryable: false });
    try {
      await provider.analyze(analysisOptions());
      expect.unreachable();
    } catch (error) {
      expect(isProviderError(error)).toBe(true);
      expect(String((error as Error).message)).not.toContain("secret-marker");
    }
  });

  it("rejects an empty response as INVALID_FORMAT", async () => {
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(undefined));
    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects a response missing a required field", async () => {
    const missingPorosity = JSON.stringify({
      hairType: "curly",
      density: "high",
      confidences: { hairType: 0.9, density: 0.8, porosity: 0.7 },
    });
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(missingPorosity));
    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects a response containing an unrecognized top-level field", async () => {
    const withExtraField = JSON.stringify({
      hairType: "curly",
      density: "high",
      porosity: "medium",
      confidences: { hairType: 0.9, density: 0.8, porosity: 0.7 },
      extraUnexpectedField: "should not be here",
    });
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(withExtraField));
    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects a response containing an unrecognized confidence sub-field", async () => {
    const withExtraConfidence = JSON.stringify({
      hairType: "curly",
      density: "high",
      porosity: "medium",
      confidences: { hairType: 0.9, density: 0.8, porosity: 0.7, faceShape: 0.5 },
    });
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(withExtraConfidence));
    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects an out-of-range or non-numeric confidence value", async () => {
    const outOfRange = JSON.stringify({
      hairType: "curly",
      density: "high",
      porosity: "medium",
      confidences: { hairType: 1.5, density: 0.8, porosity: 0.7 },
    });
    const nonNumeric = JSON.stringify({
      hairType: "curly",
      density: "high",
      porosity: "medium",
      confidences: { hairType: "high-confidence", density: 0.8, porosity: 0.7 },
    });

    await expect(
      new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(outOfRange)).analyze(analysisOptions()),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
    await expect(
      new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(nonNumeric)).analyze(analysisOptions()),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects an unrecognized enum value for hairType/density/porosity", async () => {
    const invalidEnum = JSON.stringify({
      hairType: "spiky",
      density: "high",
      porosity: "medium",
      confidences: { hairType: 0.9, density: 0.8, porosity: 0.7 },
    });
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(invalidEnum));
    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("times out after the configured duration and classifies as TIMEOUT/retryable", async () => {
    const provider = new GeminiImageAnalysisProvider(
      { apiKey: "key", model: "gemini-3.6-flash", timeoutMs: 20 },
      hangingUntilAbortedClient(),
    );

    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("defaults the timeout to 20 seconds when not overridden", () => {
    expect(GEMINI_DEFAULT_TIMEOUT_MS).toBe(20_000);
  });

  it("classifies a 401/403 as an authentication (NOT_CONFIGURED) failure, non-retryable", async () => {
    const provider401 = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(401, "unauthorized")));
    const provider403 = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(403, "forbidden")));

    await expect(provider401.analyze(analysisOptions())).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
    await expect(provider403.analyze(analysisOptions())).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
  });

  it("classifies a 429 as RATE_LIMITED, retryable", async () => {
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(429, "too many requests")));
    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("classifies a 5xx as a provider-unavailable PROVIDER_ERROR, retryable", async () => {
    const provider = new GeminiImageAnalysisProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(503, "service unavailable")));
    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("classifies an unrecognized/other failure as a non-retryable PROVIDER_ERROR without leaking the underlying message", async () => {
    const provider = new GeminiImageAnalysisProvider(
      { apiKey: "key", model: "gemini-3.6-flash" },
      rejectingClient(new Error("internal-secret-diagnostic-string")),
    );

    await expect(provider.analyze(analysisOptions())).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    try {
      await provider.analyze(analysisOptions());
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("internal-secret-diagnostic-string");
    }
  });

  it("never includes the api key in any thrown error message", async () => {
    const provider = new GeminiImageAnalysisProvider(
      { apiKey: "super-secret-api-key-value", model: "gemini-3.6-flash" },
      rejectingClient(new Error("failed while using super-secret-api-key-value")),
    );

    try {
      await provider.analyze(analysisOptions());
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("super-secret-api-key-value");
    }
  });
});
