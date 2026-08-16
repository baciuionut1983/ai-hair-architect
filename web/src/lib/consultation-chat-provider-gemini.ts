import { GoogleGenAI, Type, type Schema } from "@google/genai";

import { CORRECTABLE_ANALYSIS_FIELDS } from "./analysis-repository";
import { MEMORY_PROPOSAL_ACTION_KEYS, isMemoryProposalAction } from "./professional-memory-repository";
import {
  ConsultationChatProvider,
  type ChatProviderError,
  type ConsultationChatContext,
  type ConsultationChatResult,
} from "./consultation-chat-provider";

export const GEMINI_CHAT_PROVIDER_NAME = "gemini";
export const GEMINI_CHAT_DEFAULT_TIMEOUT_MS = 30_000;

const CORRECTION_SOURCES = ["stylist_confirmed", "client_reported"] as const;

// Mirrors contracts.ts's Locale ("en" | "ro") -- used only to render a
// human-readable name into the prompt text (Gemini's REST API has no
// dedicated language-hint config field, so this is necessarily prompt text,
// same technique as the memory-proposal reminder line below).
const LANGUAGE_NAMES: Record<"en" | "ro", string> = {
  en: "English",
  ro: "Romanian",
};

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
    // Independent of proposedCorrection -- a message can warrant either,
    // both, or neither. `action` reuses MEMORY_PROPOSAL_ACTIONS' exact
    // vocabulary (imported, not re-listed) so what the model may propose
    // can never drift from what POST /api/v1/clients/{id}/memories accepts.
    // No `nullable: true` here either, for the same reason proposedCorrection
    // omits it -- see the comment there.
    proposedMemory: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, enum: [...MEMORY_PROPOSAL_ACTION_KEYS] },
        content: { type: Type.STRING },
        reason: { type: Type.STRING },
      },
      required: ["action", "content", "reason"],
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
  "conversation history. The platform ALWAYS auto-loads this client's own most recent analysis for you before " +
  "you ever see a message, whether or not the stylist mentioned it -- so if a '=== CURRENT BASELINE ANALYSIS " +
  "===' section appears below, that IS this client's real, existing analysis from the platform right now. " +
  "Use it directly and immediately. NEVER say you don't have a baseline analysis loaded, and NEVER ask the " +
  "stylist to re-describe hair attributes, a technique, or a plan that section already gives you -- doing so " +
  "wastes the stylist's time re-typing data the platform already has. Only say an analysis is missing when " +
  "that section is genuinely and explicitly absent (replaced by 'No analysis exists yet for this client'). " +
  "Your job:\n" +
  "1. If the stylist's message states a correction, disagreement, or contradiction about a specific " +
  "observed/assumed attribute (e.g. \"her density is actually low\", \"that's not her natural texture\", " +
  "\"she had bleach six weeks ago\", \"I want to preserve more perimeter\" implying a targetShape change), " +
  "identify EXACTLY ONE affected field from the provided list and propose a correction: the field, the new " +
  "value, a short professional reason, and a source (\"stylist_confirmed\" for the stylist's own chair-side " +
  "observation/judgment, \"client_reported\" only when the stylist is explicitly relaying something the " +
  "client said, e.g. bleach/chemical history). Never propose a correction for something the message did not " +
  "actually state.\n" +
  "2. If the stylist states a professional observation, preference, or note they want remembered for later -- " +
  "especially when they explicitly say something like \"remember this\", \"note this for her file\", or " +
  "\"do not change the analysis, just note it\" -- you MUST include a proposedMemory object in this exact " +
  "JSON response. This is not optional whenever such a request is present: use action \"save_client_memory\" " +
  "for something specific to this one client (e.g. a chair-side observation, a disliked result, a styling " +
  "habit), \"save_professional_rule\" for a general technique rule the stylist wants applied broadly, " +
  "\"mark_preference\" for a stylist preference, or \"save_outcome\" only for feedback about how a completed " +
  "service actually turned out. Write a short, precise, professional content string (what should be " +
  "remembered) and a brief reason. NEVER create the memory yourself -- this is always only a proposal; the " +
  "stylist must explicitly confirm it before it becomes real, and it never changes the analysis. If the " +
  "stylist's message is really about correcting a specific analysis field instead (per rule 1), propose that " +
  "correction, not a memory -- do not propose both for the same statement unless the message genuinely " +
  "contains two distinct, separate pieces of information.\n" +
  "2b. CRITICAL consistency rule for `reply` wording: never describe an action in `reply` that is not backed " +
  "by the corresponding field in this exact same response. If you are including proposedMemory, your `reply` " +
  "must make clear this is only a SUGGESTION awaiting the stylist's confirmation -- NEVER say \"I've noted " +
  "this\", \"I've saved this\", \"I'm keeping this as...\", \"done\", or any other phrasing that implies the " +
  "memory already exists, since it does not yet exist and may never exist if the stylist edits or rejects it. " +
  "Instead say something like \"I'd like to save this as a note for her file -- take a look below and " +
  "confirm, edit, or skip it\" or \"Here's what I'll remember if you confirm it below\". If you are NOT " +
  "including proposedMemory in this response, never claim to have noted, saved, tracked, or remembered " +
  "anything -- just respond normally, or ask whether the stylist wants it saved.\n" +
  "3. If a decision-relevant field the client's plan needs is missing (most importantly targetShape/desired " +
  "result) and the conversation seems ready to move toward finalizing a plan, proactively and warmly ask for " +
  "it -- never invent it yourself.\n" +
  "4. If the stylist disagrees with or questions a chosen technique (e.g. \"I don't think scissor over comb " +
  "is right here\"), explain WHY the engine chose it using the plan's own professional reasoning above, then " +
  "discuss alternatives in terms of which underlying attribute would need to be different for the engine to " +
  "choose something else (e.g. a different hairCondition or targetShape) -- propose THAT as a correction " +
  "(per rule 1) rather than just declaring a different technique yourself, since the technique is the " +
  "engine's own output, never something you assign directly. Only discuss the plan already loaded; never " +
  "modify it in this reply.\n" +
  "5. Otherwise, just reply conversationally and helpfully.\n" +
  "6. Set needsClarification to true only when you are explicitly asking the stylist a question you need " +
  "answered before you can usefully continue (e.g. asking for the target result).\n" +
  "7. NEVER invent facts not present in the provided context or this message: no chemical/treatment history, " +
  "no visual facts you were not told, no guaranteed outcomes. If you are not sure, say so and ask. Assumptions " +
  "listed above are the engine's own professional defaults, not confirmed observations -- if you reference one, " +
  "call it an assumption, never state it as a settled fact.\n" +
  "8. Professional memory is scoped evidence, not model training. Prefer an explicit stylist professional_rule " +
  "or preference over a conflicting ai_observation, mention uncertainty when appropriate, and use confirmed outcome " +
  "feedback to improve the next recommendation. Never treat one stylist's rule as global knowledge.\n" +
  "9. Respond with strict JSON matching the provided schema only -- no markdown, no commentary outside the " +
  "JSON fields.\n" +
  "10. Language: by default, write `reply` in EXACTLY the same language as the stylist's CURRENT message -- " +
  "if it's written in Romanian, reply in Romanian; if English, reply in English; matching whatever language " +
  "this specific message uses, regardless of what language earlier messages in this conversation used. If a " +
  "'FORCED REPLY LANGUAGE' line appears below, ignore the message's own language entirely and always reply in " +
  "that language instead -- the stylist has explicitly fixed the conversation's language. If no forced language " +
  "is given and the current message's own language is genuinely ambiguous (e.g. just a name, a number, or too " +
  "short to tell), and a 'fallback reply language if ambiguous' line appears below, use that; otherwise use your " +
  "own best judgment. This rule applies to `reply` only -- field names, enum values (e.g. proposedCorrection." +
  "field, proposedMemory.action/source), and technical terms you're already told to use in English stay in " +
  "English regardless of reply language.";

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
      return this.parseAndValidate(rawText, message);
    } catch (error) {
      throw this.classifyError(error, controller.signal);
    } finally {
      clearTimeout(timer);
      outerSignal.removeEventListener("abort", onOuterAbort);
    }
  }

  private parseAndValidate(rawText: string | undefined, stylistMessage: string): ConsultationChatResult {
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
    const proposedMemory = this.parseProposedMemory(parsed.proposedMemory);

    // PRIMARY fail-closed check, deterministic: whether proposedMemory is
    // required for this turn is decided from the STYLIST'S OWN message
    // (messageRequestsMemoryProposal), which this app controls and can test
    // exhaustively -- never from Gemini's freely-chosen reply wording. A
    // live production report showed a reply using exactly the suggested
    // template phrasing ("take a look below and confirm, edit, or skip it")
    // while proposedMemory was absent; that response's authenticity depended
    // entirely on Gemini keeping its own reply text and its own structured
    // output in sync, which prompt wording alone did not reliably guarantee.
    // Keying the requirement off the stylist's input instead removes that
    // dependency: the same trigger phrase can never appear differently
    // worded by the model, because the model never generates it.
    if (!proposedMemory && messageRequestsMemoryProposal(stylistMessage)) {
      throw this.createProviderError(
        "INVALID_FORMAT",
        "The stylist explicitly asked to remember/save this, but the response did not include a proposedMemory.",
      );
    }

    // SECONDARY, defense-in-depth check: catches a reply that spontaneously
    // claims a memory proposal exists (e.g. Gemini offers to remember
    // something unprompted) even when the stylist's own message didn't match
    // the phrases above. Deliberately narrow -- see containsMemoryProposalTemplateWording.
    if (!proposedMemory && containsMemoryProposalTemplateWording(parsed.reply)) {
      throw this.createProviderError(
        "INVALID_FORMAT",
        "Gemini's reply referenced a memory proposal it did not actually include.",
      );
    }

    return {
      reply: parsed.reply.trim(),
      needsClarification: parsed.needsClarification,
      ...(proposedCorrection ? { proposedCorrection } : {}),
      ...(proposedMemory ? { proposedMemory } : {}),
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

  private parseProposedMemory(value: unknown): ConsultationChatResult["proposedMemory"] {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (!isPlainObject(value)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed proposedMemory.");
    }

    const { action, content, reason } = value;
    if (typeof action !== "string" || !isMemoryProposalAction(action)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini proposed a memory with an unrecognized action.");
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini proposed a memory with no content.");
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini proposed a memory with no reason.");
    }

    return {
      action,
      content: content.trim(),
      reason: reason.trim(),
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
      "=== CURRENT BASELINE ANALYSIS (real, already loaded from the platform for this exact client -- this " +
        "IS the baseline; never claim no baseline analysis is loaded while this section is present) ===",
      "Each value below is already established -- only propose a correction if THIS message actually " +
        "contradicts one:",
      `goal=${a.goal}, hairType=${a.hairType}, density=${a.density}, porosity=${a.porosity}`,
      `faceShape=${a.faceShape ?? "unknown"}, headShape=${a.headShape ?? "unknown"}, hairLength=${a.hairLength ?? "unknown"}`,
      `hairTexture=${a.hairTexture ?? "unknown"}, hairCondition=${a.hairCondition ?? "unknown"}, growthPattern=${a.growthPattern ?? "unknown"}`,
      `targetShape=${a.targetShape ?? "not yet decided"}`,
      `confidenceScore=${a.confidenceScore}, missingData=[${a.missingData.join(", ")}]`,
    );
    if (a.cuttingTechnique) lines.push(`Chosen cutting technique: ${a.cuttingTechnique}`);
    if (a.colorFormulaDirection) lines.push(`Chosen color formula direction: ${a.colorFormulaDirection}`);
    if (a.treatmentCategory) lines.push(`Chosen treatment category: ${a.treatmentCategory}`);
    if (a.planSummary) lines.push(`Current plan (technique + professional reasoning): ${a.planSummary}`);
    if (a.assumptions.length > 0) lines.push(`Assumptions the engine fell back on (NOT confirmed facts): ${a.assumptions.join(" | ")}`);
    if (a.contraindications.length > 0) lines.push(`Contraindications: ${a.contraindications.join(" | ")}`);
    if (a.safetyNotes.length > 0) lines.push(`Safety notes / warnings: ${a.safetyNotes.join(" | ")}`);
    if (a.clarificationAnswers.length > 0) lines.push(`Stylist's clarification answers on file: ${a.clarificationAnswers.join(" | ")}`);
  } else {
    lines.push("", "=== No analysis exists yet for this client -- this is genuinely true, not a data-loading gap. ===");
  }

  if (context.recentMessages.length > 0) {
    lines.push("", "Recent conversation (this conversation's own history -- distinct from confirmed professional memory below):");
    for (const entry of context.recentMessages) {
      lines.push(`${entry.role}: ${entry.content}`);
    }
  }

  if (context.professionalMemory.length > 0) {
    lines.push("", "Confirmed professional memory (bounded, provenance-labelled, already explicitly confirmed by a stylist -- never something typed earlier in this same conversation):");
    for (const item of context.professionalMemory) {
      lines.push(`- [${item.scope}/${item.kind}; source=${item.source}; confidence=${item.confidence}] ${item.content}`);
    }
  }

  const memory = context.clientProfessionalMemory;
  if (
    memory.recentCorrections.length > 0 ||
    memory.recentConsultations.length > 0 ||
    memory.recentFormulas.length > 0 ||
    memory.recentTreatments.length > 0
  ) {
    lines.push("", "Verified client history (explicitly saved, newest/relevant and bounded):");
    for (const item of memory.recentCorrections) lines.push(`- correction [${item.source}] ${item.fieldName}=${JSON.stringify(item.newValue)}${item.reason ? `; ${item.reason}` : ""}`);
    for (const item of memory.recentConsultations) lines.push(`- consultation: ${item.summary}; next=${item.nextSteps.join(" | ")}`);
    for (const item of memory.recentFormulas) lines.push(`- formula: ${item.name}; ${item.details}`);
    for (const item of memory.recentTreatments) lines.push(`- treatment: ${item.name}; ${item.details}`);
  }

  // See ConsultationChatContext (consultation-chat-provider.ts) for why
  // these two are mutually exclusive, and SYSTEM_INSTRUCTION rule 10 above
  // for exactly how the model is told to use them.
  if (context.forcedReplyLanguage) {
    lines.push(
      "",
      `FORCED REPLY LANGUAGE: ${LANGUAGE_NAMES[context.forcedReplyLanguage]} (${context.forcedReplyLanguage}) -- ` +
        "the stylist has explicitly fixed the conversation's language. Reply in this language regardless of what " +
        "language the message below is written in.",
    );
  } else if (context.fallbackReplyLanguage) {
    lines.push(
      "",
      `Fallback reply language if ambiguous: ${LANGUAGE_NAMES[context.fallbackReplyLanguage]} (${context.fallbackReplyLanguage}).`,
    );
  }

  lines.push("", `stylist: ${message}`);

  if (messageRequestsMemoryProposal(message)) {
    lines.push(
      "",
      "REMINDER: this exact message matched this app's own detection of an explicit remember/save/note " +
        "request. If so, you MUST include a proposedMemory object in this response (per rule 2) -- the backend " +
        "will reject this response outright if it is missing.",
    );
  }

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

// Deliberately narrow: matches only the specific template phrasing this
// file's own SYSTEM_INSTRUCTION suggests for a memory proposal ("take a
// look below and confirm, edit, or skip it" / "confirm it below"), not
// generic language. Low false-positive risk precisely because these are
// OUR OWN suggested phrases, not arbitrary natural-language patterns --
// legitimate replies unrelated to a memory proposal have no reason to use
// this exact "confirm, edit, or skip" grouping.
const MEMORY_PROPOSAL_TEMPLATE_MARKERS = [
  "confirm, edit, or skip",
  "confirm, edit or skip",
  "take a look below",
  "confirm it below",
] as const;

function containsMemoryProposalTemplateWording(reply: unknown): boolean {
  if (typeof reply !== "string") return false;
  const normalized = reply.toLocaleLowerCase();
  return MEMORY_PROPOSAL_TEMPLATE_MARKERS.some((marker) => normalized.includes(marker));
}

// Deterministic, backend-owned intent detection on the STYLIST'S OWN
// message -- the fixed text this app sent to Gemini, not anything Gemini
// generated. This is what makes the proposedMemory requirement structural:
// whether this turn needs a proposal is decided before the model ever
// responds, from input this app fully controls and can unit-test
// exhaustively, rather than inferred after the fact from the model's own
// freely-chosen paraphrase of its own action. A miss here only means the
// requirement isn't force-strengthened for this turn (Gemini may still
// propose on its own, unchanged from before); a match with no resulting
// proposedMemory is treated as a hard failure by parseAndValidate, never a
// silently broken promise.
const MEMORY_REQUEST_PHRASES = [
  "remember this",
  "remember that",
  "please remember",
  "save this",
  "note this",
  "make a note",
  "keep a note",
  "keep this in mind",
  "keep note of",
  "add this to her file",
  "add this to his file",
  "add this to their file",
  "add this to her profile",
  "add this to his profile",
  "add this to their profile",
  "record this observation",
] as const;

function messageRequestsMemoryProposal(message: string): boolean {
  const normalized = message.toLocaleLowerCase();
  return MEMORY_REQUEST_PHRASES.some((phrase) => normalized.includes(phrase));
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
