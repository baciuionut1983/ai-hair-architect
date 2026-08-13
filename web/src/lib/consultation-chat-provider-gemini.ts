import { GoogleGenAI, Type, type Schema } from "@google/genai";

import { CORRECTABLE_ANALYSIS_FIELDS } from "./analysis-repository";
import {
  ConsultationChatProvider,
  type ChatProviderError,
  type ConsultationChatContext,
  type ConsultationChatResult,
} from "./consultation-chat-provider";

export const GEMINI_CHAT_PROVIDER_NAME = "gemini";
export const GEMINI_CHAT_DEFAULT_TIMEOUT_MS = 30_000;

const CORRECTION_SOURCES = ["stylist_confirmed", "client_reported"] as const;

// Kept in sync with analysis-repository.ts's CORRECTABLE_ANALYSIS_FIELDS by
// importing it directly rather than re-listing the fields -- if that list
// ever changes, this schema (and therefore what the model is even allowed
// to propose) changes with it automatically, so the two can never drift.
//
// proposedCorrection deliberately has NO `nullable: true` -- omitting it
// from the outer `required` list already makes it optional under JSON
// Schema semantics, and Gemini's structured-output (responseSchema) support
// for `nullable` on an OBJECT-typed property (as opposed to a scalar) has
// been an unreliable, API/SDK-version-dependent construct in practice,
// capable of producing a request-level failure with zero application-level
// signal beyond "the provider is unavailable." Omission is strictly safer
// here and loses no validation power, since parseProposedCorrection already
// treats a missing/null value as "no correction" explicitly.
export const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    needsClarification: { type: Type.BOOLEAN },
    proposedCorrection: {
      type: Type.OBJECT,
      properties: {
        field: { type: Type.STRING, enum: [...CORRECTABLE_ANALYSIS_FIELDS] },
        value: { type: Type.STRING },
        reason: { type: Type.STRING },
        source: { type: Type.STRING, enum: [...CORRECTION_SOURCES] },
      },
      required: ["field", "value", "reason", "source"],
    },
  },
  required: ["reply", "needsClarification"],
};

const SYSTEM_INSTRUCTION =
  "You are the AI colleague inside AI Hair Architect, a professional hair consultation tool for " +
  "hairstylists. You are warm, welcoming, conversational, and occasionally lightly playful -- never a cold " +
  "technical manual -- while remaining professionally credible. You are talking to a licensed hairstylist " +
  "(not the end client), so you may use correct technical terminology.\n\n" +
  "You are given the CURRENT structured analysis for one client (if any exists yet), and the recent " +
  "conversation history. Your job:\n" +
  "1. If the stylist's message states a correction, disagreement, or contradiction about a specific " +
  "observed/assumed attribute (e.g. \"her density is actually low\", \"that's not her natural texture\", " +
  "\"she had bleach six weeks ago\", \"I want to preserve more perimeter\" implying a targetShape change), " +
  "identify EXACTLY ONE affected field from the provided list and propose a correction: the field, the new " +
  "value, a short professional reason, and a source (\"stylist_confirmed\" for the stylist's own chair-side " +
  "observation/judgment, \"client_reported\" only when the stylist is explicitly relaying something the " +
  "client said, e.g. bleach/chemical history). Never propose a correction for something the message did not " +
  "actually state.\n" +
  "2. If a decision-relevant field the client's plan needs is missing (most importantly targetShape/desired " +
  "result) and the conversation seems ready to move toward finalizing a plan, proactively and warmly ask for " +
  "it -- never invent it yourself.\n" +
  "3. Otherwise, just reply conversationally and helpfully.\n" +
  "4. Set needsClarification to true only when you are explicitly asking the stylist a question you need " +
  "answered before you can usefully continue (e.g. asking for the target result).\n" +
  "5. NEVER invent facts not present in the provided context or this message: no chemical/treatment history, " +
  "no visual facts you were not told, no guaranteed outcomes. If you are not sure, say so and ask.\n" +
  "6. Respond with strict JSON matching the provided schema only -- no markdown, no commentary outside the " +
  "JSON fields.";

export interface GeminiConsultationChatProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface GeminiChatGenerateInput {
  prompt: string;
  model: string;
  signal: AbortSignal;
}

export interface GeminiChatGenerateClient {
  generateContent(input: GeminiChatGenerateInput): Promise<string | undefined>;
}

export class GeminiConsultationChatProvider extends ConsultationChatProvider {
  readonly name = GEMINI_CHAT_PROVIDER_NAME;
  readonly modelVersion: string;

  private readonly client: GeminiChatGenerateClient;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiConsultationChatProviderOptions, client?: GeminiChatGenerateClient) {
    super();

    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw this.createProviderError("NOT_CONFIGURED", "Gemini chat provider requires an API key.");
    }
    if (!options.model || options.model.trim().length === 0) {
      throw this.createProviderError("NOT_CONFIGURED", "Gemini chat provider requires a model identifier.");
    }

    this.model = options.model;
    this.modelVersion = options.model;
    this.timeoutMs = options.timeoutMs ?? GEMINI_CHAT_DEFAULT_TIMEOUT_MS;
    this.client = client ?? createDefaultGeminiChatClient(options.apiKey, this.timeoutMs);
  }

  async respond(message: string, context: ConsultationChatContext, outerSignal: AbortSignal): Promise<ConsultationChatResult> {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    outerSignal.addEventListener("abort", onOuterAbort);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const rawText = await this.client.generateContent({
        prompt: buildPrompt(message, context),
        model: this.model,
        signal: controller.signal,
      });
      return this.parseAndValidate(rawText);
    } catch (error) {
      throw this.classifyError(error, controller.signal);
    } finally {
      clearTimeout(timer);
      outerSignal.removeEventListener("abort", onOuterAbort);
    }
  }

  private parseAndValidate(rawText: string | undefined): ConsultationChatResult {
    if (!rawText || rawText.trim().length === 0) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini returned an empty response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw this.createProviderError("INVALID_FORMAT", "Gemini returned malformed JSON.");
    }

    if (!isPlainObject(parsed)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response is not a JSON object.");
    }
    if (typeof parsed.reply !== "string" || parsed.reply.trim().length === 0) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response is missing a reply.");
    }
    if (typeof parsed.needsClarification !== "boolean") {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response is missing needsClarification.");
    }

    const proposedCorrection = this.parseProposedCorrection(parsed.proposedCorrection);

    return {
      reply: parsed.reply.trim(),
      needsClarification: parsed.needsClarification,
      ...(proposedCorrection ? { proposedCorrection } : {}),
    };
  }

  private parseProposedCorrection(value: unknown): ConsultationChatResult["proposedCorrection"] {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (!isPlainObject(value)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed proposedCorrection.");
    }

    const { field, value: correctionValue, reason, source } = value;
    if (typeof field !== "string" || !(CORRECTABLE_ANALYSIS_FIELDS as readonly string[]).includes(field)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini proposed a correction for an unrecognized field.");
    }
    if (typeof correctionValue !== "string" || correctionValue.trim().length === 0) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini proposed a correction with no value.");
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini proposed a correction with no reason.");
    }
    if (typeof source !== "string" || !(CORRECTION_SOURCES as readonly string[]).includes(source)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini proposed a correction with an invalid source.");
    }

    return {
      field,
      value: correctionValue.trim(),
      reason: reason.trim(),
      source: source as "stylist_confirmed" | "client_reported",
    };
  }

  private classifyError(error: unknown, signal: AbortSignal): ChatProviderError {
    if (isChatProviderError(error)) {
      return error;
    }
    if (signal.aborted) {
      return this.createProviderError("TIMEOUT", "Gemini chat request timed out.", true);
    }

    const status = extractHttpStatus(error);
    if (status === 401 || status === 403) {
      return this.createProviderError("NOT_CONFIGURED", "Gemini authentication failed.", false, status);
    }
    if (status === 429) {
      return this.createProviderError("RATE_LIMITED", "Gemini rate limit exceeded.", true, status);
    }
    if (typeof status === "number" && status >= 500) {
      return this.createProviderError("PROVIDER_ERROR", "Gemini service unavailable.", true, status);
    }
    return this.createProviderError("PROVIDER_ERROR", "Gemini request failed.", false, status);
  }
}

function buildPrompt(message: string, context: ConsultationChatContext): string {
  const lines: string[] = [SYSTEM_INSTRUCTION, "", `Client: ${context.clientFullName}`];

  if (context.currentAnalysis) {
    const a = context.currentAnalysis;
    lines.push(
      "",
      "Current analysis (each value's provenance is not repeated here, but treat every value as already " +
        "established -- only propose a correction if THIS message actually contradicts one):",
      `goal=${a.goal}, hairType=${a.hairType}, density=${a.density}, porosity=${a.porosity}`,
      `faceShape=${a.faceShape ?? "unknown"}, headShape=${a.headShape ?? "unknown"}, hairLength=${a.hairLength ?? "unknown"}`,
      `hairTexture=${a.hairTexture ?? "unknown"}, hairCondition=${a.hairCondition ?? "unknown"}, growthPattern=${a.growthPattern ?? "unknown"}`,
      `targetShape=${a.targetShape ?? "not yet decided"}`,
      `confidenceScore=${a.confidenceScore}, missingData=[${a.missingData.join(", ")}]`,
    );
    if (a.planSummary) lines.push(`Current plan: ${a.planSummary}`);
  } else {
    lines.push("", "No analysis exists yet for this client in this conversation.");
  }

  if (context.recentMessages.length > 0) {
    lines.push("", "Recent conversation:");
    for (const entry of context.recentMessages) {
      lines.push(`${entry.role}: ${entry.content}`);
    }
  }

  lines.push("", `stylist: ${message}`);
  return lines.join("\n");
}

function createDefaultGeminiChatClient(apiKey: string, timeoutMs: number): GeminiChatGenerateClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateContent({ prompt, model, signal }: GeminiChatGenerateInput) {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          abortSignal: signal,
          httpOptions: { timeout: timeoutMs },
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      return response.text;
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatProviderError(error: unknown): error is ChatProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
