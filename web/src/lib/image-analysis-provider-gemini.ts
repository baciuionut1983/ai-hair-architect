import { GoogleGenAI, Type, type Schema } from "@google/genai";

import type { AiUsageQuantities } from "./ai-usage-contracts";
import { mapGeminiUsageMetadata, type GeminiRawUsageMetadata } from "./gemini-usage-mapper";
import {
  ImageAnalysisProvider,
  type AnalysisOptions,
  type FieldConfidence,
  type ImageAnalysisResult,
  type ProviderError,
} from "./image-analysis-provider";

export const GEMINI_PROVIDER_NAME = "gemini";
// Was 20s -- measurably too tight for a real (non-mocked) Gemini vision call
// in production: base64-encoding and uploading a multi-MB photo, plus the
// model's own inference time, plus normal network latency from Railway to
// Google's API, routinely exceeds 20s even for a healthy request. This was
// the confirmed root cause of PROVIDER_TIMEOUT in production. 45s keeps the
// same fail-closed abort behavior, just with a realistic budget; callers can
// override it further via AI_ANALYSIS_TIMEOUT_MS (image-analysis-provider-config.ts).
export const GEMINI_DEFAULT_TIMEOUT_MS = 45_000;

const HAIR_TYPES = ["straight", "wavy", "curly", "coily", "unknown"] as const;
const DENSITIES = ["low", "medium", "high", "unknown"] as const;
const POROSITIES = ["low", "medium", "high", "unknown"] as const;
const FACE_SHAPES = ["oval", "round", "square", "heart", "diamond", "oblong", "unknown"] as const;
const HEAD_SHAPES = ["balanced", "flat_occipital", "prominent_crown", "wide_parietal", "irregular_occipital", "unknown"] as const;
const HAIR_LENGTHS = ["pixie", "short", "medium", "long", "extra_long", "unknown"] as const;
const GROWTH_PATTERNS = ["regular", "double_crown", "front_cowlick", "nape_whorl", "strong_widow_peak", "unknown"] as const;

const REQUIRED_FIELDS = ["hairType", "density", "porosity", "faceShape", "headShape", "hairLength", "growthPattern"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

const FIELD_ENUMS: Record<RequiredField, readonly string[]> = {
  hairType: HAIR_TYPES,
  density: DENSITIES,
  porosity: POROSITIES,
  faceShape: FACE_SHAPES,
  headShape: HEAD_SHAPES,
  hairLength: HAIR_LENGTHS,
  growthPattern: GROWTH_PATTERNS,
};

// Deliberately excluded from what Gemini is ever asked to classify -- not
// because they're unimportant, but because they are not safely determinable
// from a single client photo:
//  - hairCondition mixes a visual symptom (damage/breakage) with a
//    historical cause (recent chemical processing) in one enum; the
//    professional signal for it comes from the clarification flow
//    (analysis-engine.ts's deriveHairConditionFromClarifications), which
//    asks the stylist directly, never guessed from pixels.
//  - hairTexture is a duplicate of hairType (both are the same
//    straight/wavy/curly/coily scale) -- texture already flows through
//    hairType via photo-analysis-request-mapper.ts, so asking for it twice
//    would only invite disagreement between two answers to the same
//    question.
//  - targetShape is the client/stylist's declared intent, not an
//    observation -- never inferred from a photo, by explicit product
//    decision.
const UNSUPPORTED_FIELDS = ["hairTexture", "hairCondition", "targetShape"] as const;

const ANALYSIS_PROMPT =
  "Analyze the hair and head/face shown in this photo and classify these attributes: " +
  "hairType (one of: straight, wavy, curly, coily, unknown), " +
  "density (one of: low, medium, high, unknown), " +
  "porosity (one of: low, medium, high, unknown), " +
  "faceShape (one of: oval, round, square, heart, diamond, oblong, unknown), " +
  "headShape (one of: balanced, flat_occipital, prominent_crown, wide_parietal, irregular_occipital, unknown), " +
  "hairLength (one of: pixie, short, medium, long, extra_long, unknown), " +
  "growthPattern (one of: regular, double_crown, front_cowlick, nape_whorl, strong_widow_peak, unknown). " +
  "Use \"unknown\" whenever the photo does not show that attribute clearly enough to classify it -- " +
  "for example, headShape and growthPattern often require a profile, crown, or nape view that a single " +
  "frontal photo does not show, and porosity/density require reasonably close, well-lit hair. " +
  "Set that attribute's confidence to 0 whenever you return \"unknown\" for it. " +
  "Only classify what is visually observable in this specific photo -- never guess a client's chemical " +
  "or treatment history, and never infer a desired/target style, since neither is visible in a photo. " +
  "Respond with strict JSON matching the provided schema. Do not include any " +
  "commentary, markdown formatting, or fields other than those defined in the schema.";

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    hairType: { type: Type.STRING, enum: [...HAIR_TYPES] },
    density: { type: Type.STRING, enum: [...DENSITIES] },
    porosity: { type: Type.STRING, enum: [...POROSITIES] },
    faceShape: { type: Type.STRING, enum: [...FACE_SHAPES] },
    headShape: { type: Type.STRING, enum: [...HEAD_SHAPES] },
    hairLength: { type: Type.STRING, enum: [...HAIR_LENGTHS] },
    growthPattern: { type: Type.STRING, enum: [...GROWTH_PATTERNS] },
    confidences: {
      type: Type.OBJECT,
      properties: {
        hairType: { type: Type.NUMBER },
        density: { type: Type.NUMBER },
        porosity: { type: Type.NUMBER },
        faceShape: { type: Type.NUMBER },
        headShape: { type: Type.NUMBER },
        hairLength: { type: Type.NUMBER },
        growthPattern: { type: Type.NUMBER },
      },
      required: [...REQUIRED_FIELDS],
    },
  },
  required: [...REQUIRED_FIELDS, "confidences"],
};

export interface GeminiImageAnalysisProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface GeminiGenerateContentInput {
  imageBase64: string;
  mimeType: string;
  model: string;
  signal: AbortSignal;
  // AI Usage & Cost Metering Phase 1: see GeminiChatGenerateInput's own
  // onUsage comment (consultation-chat-provider-gemini.ts) -- identical
  // reasoning and identical backward-compatibility guarantee for this
  // file's own existing tests.
  onUsage?: (usage: GeminiRawUsageMetadata | undefined, providerRequestId: string | undefined) => void;
}

/**
 * Minimal client seam the adapter depends on, instead of the full
 * @google/genai surface. Keeps the adapter's own logic (parsing, validation,
 * error classification) testable with a plain mock, with no live network
 * calls and no SDK internals leaking into tests.
 */
export interface GeminiGenerateContentClient {
  generateContent(input: GeminiGenerateContentInput): Promise<string | undefined>;
}

export class GeminiImageAnalysisProvider extends ImageAnalysisProvider {
  readonly name = GEMINI_PROVIDER_NAME;
  readonly modelVersion: string;

  private readonly client: GeminiGenerateContentClient;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiImageAnalysisProviderOptions, client?: GeminiGenerateContentClient) {
    super();

    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw this.createProviderError("NOT_CONFIGURED", "Gemini provider requires an API key.");
    }
    if (!options.model || options.model.trim().length === 0) {
      throw this.createProviderError("NOT_CONFIGURED", "Gemini provider requires a model identifier.");
    }

    this.model = options.model;
    this.modelVersion = options.model;
    this.timeoutMs = options.timeoutMs ?? GEMINI_DEFAULT_TIMEOUT_MS;
    this.client = client ?? createDefaultGeminiClient(options.apiKey, this.timeoutMs);
  }

  async analyze(options: AnalysisOptions): Promise<{
    result: ImageAnalysisResult;
    confidences: FieldConfidence;
    warnings: string[];
    limitations: string[];
    usage?: AiUsageQuantities;
    providerRequestId?: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // Captured via closure, not provider-instance state -- see
    // GeminiConsultationChatProvider.respond's identical comment for why.
    let capturedUsage: GeminiRawUsageMetadata | undefined;
    let capturedRequestId: string | undefined;

    try {
      const rawText = await this.client.generateContent({
        imageBase64: options.imageBuffer.toString("base64"),
        mimeType: options.mimeType,
        model: this.model,
        signal: controller.signal,
        onUsage: (usage, requestId) => {
          capturedUsage = usage;
          capturedRequestId = requestId;
        },
      });
      const parsed = this.parseAndValidate(rawText);
      const usage = mapGeminiUsageMetadata(capturedUsage);
      return {
        ...parsed,
        ...(usage ? { usage } : {}),
        ...(capturedRequestId ? { providerRequestId: capturedRequestId } : {}),
      };
    } catch (error) {
      throw this.classifyError(error, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private parseAndValidate(rawText: string | undefined): {
    result: ImageAnalysisResult;
    confidences: FieldConfidence;
    warnings: string[];
    limitations: string[];
  } {
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

    const topLevelKeys = new Set(Object.keys(parsed));
    const allowedTopLevelKeys = new Set<string>([...REQUIRED_FIELDS, "confidences"]);
    for (const key of topLevelKeys) {
      if (!allowedTopLevelKeys.has(key)) {
        throw this.createProviderError("INVALID_FORMAT", "Gemini response contains an unrecognized field.");
      }
    }
    for (const key of allowedTopLevelKeys) {
      if (!topLevelKeys.has(key)) {
        throw this.createProviderError("INVALID_FORMAT", "Gemini response is missing a required field.");
      }
    }

    const values: Record<RequiredField, string> = {} as Record<RequiredField, string>;
    for (const field of REQUIRED_FIELDS) {
      const value = parsed[field];
      if (!isEnumValue(value, FIELD_ENUMS[field])) {
        throw this.createProviderError("INVALID_FORMAT", `Gemini response has a malformed ${field} value.`);
      }
      values[field] = value;
    }

    if (!isPlainObject(parsed.confidences)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed confidences object.");
    }
    const confidenceKeys = new Set(Object.keys(parsed.confidences));
    const allowedConfidenceKeys = new Set<string>(REQUIRED_FIELDS);
    for (const key of confidenceKeys) {
      if (!allowedConfidenceKeys.has(key)) {
        throw this.createProviderError("INVALID_FORMAT", "Gemini response contains an unrecognized confidence field.");
      }
    }
    for (const key of allowedConfidenceKeys) {
      if (!confidenceKeys.has(key)) {
        throw this.createProviderError("INVALID_FORMAT", "Gemini response is missing a required confidence field.");
      }
    }

    const confidenceValues: Record<RequiredField, number> = {} as Record<RequiredField, number>;
    for (const field of REQUIRED_FIELDS) {
      const value = (parsed.confidences as Record<string, unknown>)[field];
      if (!isValidConfidence(value)) {
        throw this.createProviderError("INVALID_FORMAT", `Gemini response has a malformed ${field} confidence value.`);
      }
      confidenceValues[field] = value;
    }

    const result: ImageAnalysisResult = {
      hairType: values.hairType as ImageAnalysisResult["hairType"],
      density: values.density as ImageAnalysisResult["density"],
      porosity: values.porosity as ImageAnalysisResult["porosity"],
      faceShape: toNullableValue(values.faceShape),
      headShape: toNullableValue(values.headShape),
      hairLength: toNullableValue(values.hairLength),
      hairTexture: null,
      hairCondition: null,
      growthPattern: toNullableValue(values.growthPattern),
      targetShape: null,
    };

    const confidences: FieldConfidence = { ...confidenceValues };
    for (const field of UNSUPPORTED_FIELDS) {
      confidences[field] = 0;
    }

    return {
      result,
      confidences,
      warnings: ["Automated analysis limited to visually observable attributes (Gemini provider)."],
      limitations: [
        "Cannot determine hairTexture (duplicate of hairType), hairCondition (requires chemical/treatment history), or targetShape (client/stylist intent, not visible in a photo)",
        "headShape and growthPattern frequently return \"unknown\" for a single frontal photo -- they require a profile, crown, or nape view",
        "Confidence scores below 0.7 require manual verification",
      ],
    };
  }

  private classifyError(error: unknown, signal: AbortSignal): ProviderError {
    if (isProviderError(error)) {
      return error;
    }
    if (signal.aborted) {
      return this.createProviderError("TIMEOUT", "Gemini request timed out.", true);
    }

    const status = extractHttpStatus(error);
    if (status === 401 || status === 403) {
      return this.createProviderError("NOT_CONFIGURED", "Gemini authentication failed.", false);
    }
    if (status === 429) {
      return this.createProviderError("RATE_LIMITED", "Gemini rate limit exceeded.", true);
    }
    if (typeof status === "number" && status >= 500) {
      return this.createProviderError("PROVIDER_ERROR", "Gemini service unavailable.", true);
    }
    return this.createProviderError("PROVIDER_ERROR", "Gemini request failed.", false);
  }
}

function createDefaultGeminiClient(apiKey: string, timeoutMs: number): GeminiGenerateContentClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateContent({ imageBase64, mimeType, model, signal, onUsage }: GeminiGenerateContentInput) {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: ANALYSIS_PROMPT }, { inlineData: { mimeType, data: imageBase64 } }],
          },
        ],
        config: {
          abortSignal: signal,
          httpOptions: { timeout: timeoutMs },
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      onUsage?.(response.usageMetadata, response.responseId);
      return response.text;
    },
  };
}

// "unknown" is a valid classification (the photo genuinely doesn't show
// enough to tell), but downstream (photo-analysis-request-mapper.ts's
// pickEnum) only ever recognizes the real enum values -- never "unknown" --
// so this keeps that same fail-closed contract explicit at the source
// instead of relying on it implicitly.
function toNullableValue<T extends string>(value: T): T | null {
  return value === "unknown" ? null : value;
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isValidConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderError(error: unknown): error is ProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
