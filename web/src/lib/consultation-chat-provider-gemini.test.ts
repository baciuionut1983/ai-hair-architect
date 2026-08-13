import { describe, expect, it } from "vitest";

import {
  GEMINI_CHAT_DEFAULT_TIMEOUT_MS,
  GEMINI_CHAT_PROVIDER_NAME,
  GeminiConsultationChatProvider,
  type GeminiChatGenerateClient,
  type GeminiChatGenerateInput,
} from "./consultation-chat-provider-gemini";
import type { ChatProviderError, ConsultationChatContext } from "./consultation-chat-provider";

function context(overrides: Partial<ConsultationChatContext> = {}): ConsultationChatContext {
  return {
    clientFullName: "Jane Doe",
    recentMessages: [],
    ...overrides,
  };
}

function fixedClient(text: string | undefined): GeminiChatGenerateClient {
  return { async generateContent() { return text; } };
}

function rejectingClient(error: unknown): GeminiChatGenerateClient {
  return { async generateContent() { throw error; } };
}

function recordingClient(sink: { input?: GeminiChatGenerateInput }, text: string): GeminiChatGenerateClient {
  return {
    async generateContent(input) {
      sink.input = input;
      return text;
    },
  };
}

function hangingUntilAbortedClient(): GeminiChatGenerateClient {
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

function isChatProviderError(error: unknown): error is ChatProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

describe("GeminiConsultationChatProvider", () => {
  it("fails closed synchronously on invalid configuration (empty api key / model)", () => {
    expect(() => new GeminiConsultationChatProvider({ apiKey: "", model: "gemini-3.6-flash" })).toThrow();
    expect(() => new GeminiConsultationChatProvider({ apiKey: "key", model: "" })).toThrow();
  });

  it("exposes the expected name and model version", () => {
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient("{}"));
    expect(provider.name).toBe(GEMINI_CHAT_PROVIDER_NAME);
    expect(provider.modelVersion).toBe("gemini-3.6-flash");
  });

  it("defaults the timeout to 30 seconds when not overridden", () => {
    expect(GEMINI_CHAT_DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it("parses a plain conversational reply with no proposed correction", async () => {
    const response = JSON.stringify({ reply: "Sure, tell me more about her hair!", needsClarification: false });
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(response));

    const result = await provider.respond("Hi there", context(), new AbortController().signal);

    expect(result).toEqual({ reply: "Sure, tell me more about her hair!", needsClarification: false });
  });

  it("parses a reply with a proposed correction, never applying anything itself", async () => {
    const response = JSON.stringify({
      reply: "Got it -- I'll factor in that her density is actually low.",
      needsClarification: false,
      proposedCorrection: { field: "density", value: "low", reason: "Stylist observed low density chair-side.", source: "stylist_confirmed" },
    });
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(response));

    const result = await provider.respond("Her density is actually low", context(), new AbortController().signal);

    expect(result.proposedCorrection).toEqual({
      field: "density",
      value: "low",
      reason: "Stylist observed low density chair-side.",
      source: "stylist_confirmed",
    });
  });

  it("rejects a proposed correction for an unrecognized field (e.g. goal, or a made-up field)", async () => {
    const response = JSON.stringify({
      reply: "...",
      needsClarification: false,
      proposedCorrection: { field: "goal", value: "reshape", reason: "...", source: "stylist_confirmed" },
    });
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(response));

    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects a proposed correction with an invalid source (never accepts visual_ai/historical/assumed)", async () => {
    const response = JSON.stringify({
      reply: "...",
      needsClarification: false,
      proposedCorrection: { field: "density", value: "low", reason: "...", source: "visual_ai" },
    });
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(response));

    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects a response missing reply or needsClarification", async () => {
    const provider1 = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(JSON.stringify({ needsClarification: false })));
    await expect(provider1.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });

    const provider2 = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(JSON.stringify({ reply: "hi" })));
    await expect(provider2.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects malformed JSON as INVALID_FORMAT without leaking the raw response text", async () => {
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient("not-json-secret-marker"));

    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
    try {
      await provider.respond("msg", context(), new AbortController().signal);
      expect.unreachable();
    } catch (error) {
      expect(isChatProviderError(error)).toBe(true);
      expect(String((error as Error).message)).not.toContain("secret-marker");
    }
  });

  it("rejects an empty response as INVALID_FORMAT", async () => {
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(undefined));
    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("includes the current analysis context and recent messages in the prompt sent to the model", async () => {
    const sink: { input?: GeminiChatGenerateInput } = {};
    const provider = new GeminiConsultationChatProvider(
      { apiKey: "key", model: "gemini-3.6-flash" },
      recordingClient(sink, JSON.stringify({ reply: "ok", needsClarification: false })),
    );

    await provider.respond("Her density is low", context({
      currentAnalysis: {
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        confidenceScore: 0.76,
        missingData: ["targetShape"],
      },
      recentMessages: [{ role: "stylist", content: "Previous message" }],
    }), new AbortController().signal);

    expect(sink.input?.model).toBe("gemini-3.6-flash");
    expect(sink.input?.prompt).toContain("Jane Doe");
    expect(sink.input?.prompt).toContain("goal=reshape");
    expect(sink.input?.prompt).toContain("targetShape");
    expect(sink.input?.prompt).toContain("Previous message");
    expect(sink.input?.prompt).toContain("Her density is low");
  });

  it("times out after the configured duration and classifies as TIMEOUT/retryable", async () => {
    const provider = new GeminiConsultationChatProvider(
      { apiKey: "key", model: "gemini-3.6-flash", timeoutMs: 20 },
      hangingUntilAbortedClient(),
    );

    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("aborts immediately when the caller's own signal is aborted, even before the internal timeout", async () => {
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, hangingUntilAbortedClient());
    const controller = new AbortController();
    const pending = provider.respond("msg", context(), controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("classifies a 401/403 as an authentication (NOT_CONFIGURED) failure, non-retryable", async () => {
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(401, "unauthorized")));
    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
  });

  it("classifies a 429 as RATE_LIMITED, retryable", async () => {
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(429, "too many requests")));
    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("classifies a 5xx as a provider-unavailable PROVIDER_ERROR, retryable", async () => {
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(503, "service unavailable")));
    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("never includes the api key in any thrown error message", async () => {
    const provider = new GeminiConsultationChatProvider(
      { apiKey: "super-secret-chat-api-key", model: "gemini-3.6-flash" },
      rejectingClient(new Error("failed while using super-secret-chat-api-key")),
    );

    try {
      await provider.respond("msg", context(), new AbortController().signal);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("super-secret-chat-api-key");
    }
  });
});
