import { describe, expect, it } from "vitest";

import {
  GEMINI_CHAT_DEFAULT_TIMEOUT_MS,
  GEMINI_CHAT_PROVIDER_NAME,
  GeminiConsultationChatProvider,
  RESPONSE_SCHEMA,
  type GeminiChatGenerateClient,
  type GeminiChatGenerateInput,
} from "./consultation-chat-provider-gemini";
import type { ChatProviderError, ConsultationChatContext } from "./consultation-chat-provider";

function context(overrides: Partial<ConsultationChatContext> = {}): ConsultationChatContext {
  return {
    clientFullName: "Jane Doe",
    recentMessages: [],
    professionalMemory: [],
    clientProfessionalMemory: { recentCorrections: [], recentConsultations: [], recentFormulas: [], recentTreatments: [] },
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

function hasNullable(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasNullable);
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.nullable === true) {
    return true;
  }
  return Object.values(record).some(hasNullable);
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

  // A: the AI can recognize a "remember this" professional observation and
  // propose it as a memory candidate -- never create it itself.
  it("parses a reply with a proposed memory candidate, never applying anything itself", async () => {
    const response = JSON.stringify({
      reply: "Got it -- I'll note that as a professional observation for her file.",
      needsClarification: false,
      proposedMemory: {
        action: "save_client_memory",
        content: "Low density in the temporal areas; preserve more weight around the perimeter.",
        reason: "Stylist confirmed this chair-side and asked it to be remembered without changing the analysis.",
      },
    });
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(response));

    const result = await provider.respond("Remember this as a professional observation for this client.", context(), new AbortController().signal);

    expect(result.proposedMemory).toEqual({
      action: "save_client_memory",
      content: "Low density in the temporal areas; preserve more weight around the perimeter.",
      reason: "Stylist confirmed this chair-side and asked it to be remembered without changing the analysis.",
    });
    expect(result.proposedCorrection).toBeUndefined();
  });

  it("a reply can propose both a correction and a memory when the message genuinely contains both", async () => {
    const response = JSON.stringify({
      reply: "Noted both.",
      needsClarification: false,
      proposedCorrection: { field: "density", value: "low", reason: "Chair-side observation.", source: "stylist_confirmed" },
      proposedMemory: { action: "mark_preference", content: "Prefers to preserve perimeter weight.", reason: "Stated preference." },
    });
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(response));

    const result = await provider.respond("msg", context(), new AbortController().signal);

    expect(result.proposedCorrection).toBeDefined();
    expect(result.proposedMemory).toBeDefined();
  });

  it("rejects a proposed memory with an unrecognized action", async () => {
    const response = JSON.stringify({
      reply: "...",
      needsClarification: false,
      proposedMemory: { action: "delete_everything", content: "x", reason: "x" },
    });
    const provider = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(response));

    await expect(provider.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("rejects a proposed memory with no content or no reason", async () => {
    const noContent = JSON.stringify({ reply: "...", needsClarification: false, proposedMemory: { action: "save_client_memory", content: "", reason: "x" } });
    const provider1 = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(noContent));
    await expect(provider1.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });

    const noReason = JSON.stringify({ reply: "...", needsClarification: false, proposedMemory: { action: "save_client_memory", content: "x", reason: "" } });
    const provider2 = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, fixedClient(noReason));
    await expect(provider2.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
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
        assumptions: [],
        contraindications: [],
        safetyNotes: [],
        clarificationAnswers: [],
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

  // Regression: the exact production bug ("we don't have a baseline
  // analysis loaded" even though the client had a real, existing analysis)
  // was a prompt-level gap as much as a data-loading one -- the model was
  // never told, in the system instruction itself, that the platform
  // auto-loads this context and that it must never claim otherwise.
  it("the system instruction explicitly forbids claiming no baseline analysis is loaded when one is present", async () => {
    const sink: { input?: GeminiChatGenerateInput } = {};
    const provider = new GeminiConsultationChatProvider(
      { apiKey: "key", model: "gemini-3.6-flash" },
      recordingClient(sink, JSON.stringify({ reply: "ok", needsClarification: false })),
    );

    await provider.respond("hi", context(), new AbortController().signal);

    expect(sink.input?.prompt).toContain("NEVER say you don't have a baseline analysis loaded");
  });

  it("the system instruction explicitly tells the model it MUST include proposedMemory for a 'remember this' observation, never create it directly", async () => {
    const sink: { input?: GeminiChatGenerateInput } = {};
    const provider = new GeminiConsultationChatProvider(
      { apiKey: "key", model: "gemini-3.6-flash" },
      recordingClient(sink, JSON.stringify({ reply: "ok", needsClarification: false })),
    );

    await provider.respond("hi", context(), new AbortController().signal);

    expect(sink.input?.prompt).toContain("you MUST include a proposedMemory object in this exact");
    expect(sink.input?.prompt).toContain("NEVER create the memory yourself");
  });

  // Regression: a production report where the reply said "I've noted...
  // I'm keeping this as a client memory candidate" while proposedMemory was
  // absent -- misleadingly implying the memory already existed. A full code
  // audit found no bug in parsing/persistence/routing/UI (all correctly
  // forward proposedMemory when present), so the fix is here: the
  // instruction must explicitly forbid "already done" phrasing whenever
  // proposedMemory isn't (or must be) present in the same response.
  it("the system instruction forbids 'already done' phrasing (I've noted/saved/kept) unless proposedMemory is actually present in the same response", async () => {
    const sink: { input?: GeminiChatGenerateInput } = {};
    const provider = new GeminiConsultationChatProvider(
      { apiKey: "key", model: "gemini-3.6-flash" },
      recordingClient(sink, JSON.stringify({ reply: "ok", needsClarification: false })),
    );

    await provider.respond("hi", context(), new AbortController().signal);

    const prompt = sink.input?.prompt ?? "";
    expect(prompt).toContain("NEVER say \"I've noted this\", \"I've saved this\", \"I'm keeping this as...\", \"done\"");
    expect(prompt).toContain("never claim to have noted, saved, tracked, or remembered anything");
  });

  it("renders the chosen technique, assumptions, contraindications, safety notes, and clarification answers for the real Scissor Over Comb scenario", async () => {
    const sink: { input?: GeminiChatGenerateInput } = {};
    const provider = new GeminiConsultationChatProvider(
      { apiKey: "key", model: "gemini-3.6-flash" },
      recordingClient(sink, JSON.stringify({ reply: "ok", needsClarification: false })),
    );

    await provider.respond("I disagree with scissor over comb for this client.", context({
      currentAnalysis: {
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        confidenceScore: 0.82,
        missingData: [],
        assumptions: ["Assumed even density across the crown."],
        contraindications: ["Avoid double-process lightening this session."],
        safetyNotes: ["Perform a strand test before lightening."],
        clarificationAnswers: ["No known allergies."],
        cuttingTechnique: "scissor_over_comb",
        planSummary: "Structural technique: internal layering with cutting technique scissor over comb.",
      },
    }), new AbortController().signal);

    const prompt = sink.input?.prompt ?? "";
    expect(prompt).toContain("scissor_over_comb");
    expect(prompt).toContain("Assumed even density across the crown.");
    expect(prompt).toContain("Avoid double-process lightening this session.");
    expect(prompt).toContain("Perform a strand test before lightening.");
    expect(prompt).toContain("No known allergies.");
  });

  it("renders confirmed professional memory and verified client history distinctly from the live conversation", async () => {
    const sink: { input?: GeminiChatGenerateInput } = {};
    const provider = new GeminiConsultationChatProvider(
      { apiKey: "key", model: "gemini-3.6-flash" },
      recordingClient(sink, JSON.stringify({ reply: "ok", needsClarification: false })),
    );

    await provider.respond("hi", context({
      professionalMemory: [
        { scope: "stylist_specific", kind: "professional_rule", content: "Prefer texturizing over scissor-over-comb on fine hair.", source: "typed", confidence: 1 },
      ],
      clientProfessionalMemory: {
        recentCorrections: [{ fieldName: "hairCondition", newValue: "fragile_breakage", source: "stylist_confirmed", reason: "Bleached six weeks ago.", createdAt: "2026-08-01T00:00:00.000Z" }],
        recentConsultations: [{ summary: "First visit, discussed color correction.", nextSteps: ["Strand test next time."], createdAt: "2026-08-01T00:00:00.000Z" }],
        recentFormulas: [{ name: "Root touch-up 6N", details: "20vol, 30 min.", createdAt: "2026-08-01T00:00:00.000Z" }],
        recentTreatments: [{ name: "Bond repair", details: "Olaplex #2", createdAt: "2026-08-01T00:00:00.000Z" }],
      },
    }), new AbortController().signal);

    const prompt = sink.input?.prompt ?? "";
    expect(prompt).toContain("Prefer texturizing over scissor-over-comb on fine hair.");
    expect(prompt).toContain("hairCondition=");
    expect(prompt).toContain("Bleached six weeks ago.");
    expect(prompt).toContain("First visit, discussed color correction.");
    expect(prompt).toContain("Root touch-up 6N");
    expect(prompt).toContain("Bond repair");
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

  // Regression: a production report ("The AI consultation assistant is not
  // available right now.") could not be root-caused without the real HTTP
  // status Gemini returned surviving into the classified error -- previously
  // it was discarded after classification, so Railway logs could only ever
  // show a coarse code, never distinguishing e.g. a 400 schema rejection
  // from a genuine 500. These lock in that the real status is preserved.
  it("carries the real HTTP status through onto the classified error, for diagnostics", async () => {
    const provider401 = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(401, "unauthorized")));
    await expect(provider401.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ status: 401 });

    const provider429 = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(429, "too many requests")));
    await expect(provider429.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ status: 429 });

    const provider503 = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(503, "service unavailable")));
    await expect(provider503.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ status: 503 });

    const provider400 = new GeminiConsultationChatProvider({ apiKey: "key", model: "gemini-3.6-flash" }, rejectingClient(httpError(400, "invalid schema")));
    await expect(provider400.respond("msg", context(), new AbortController().signal)).rejects.toMatchObject({ status: 400 });
  });

  // Regression: the schema previously marked proposedCorrection as
  // `nullable: true` on an OBJECT-typed property -- a construct with
  // unreliable support in Gemini's structured-output (responseSchema) across
  // API/SDK versions, capable of failing the whole request with no
  // application-visible signal beyond "provider unavailable". It is already
  // optional by omission from the outer `required` list, so `nullable` adds
  // no validation power and is never reintroduced.
  it("never marks any schema property as nullable -- optionality comes only from omission in `required`", () => {
    expect(hasNullable(RESPONSE_SCHEMA)).toBe(false);
    expect(RESPONSE_SCHEMA.required).toEqual(["reply", "needsClarification"]);
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
