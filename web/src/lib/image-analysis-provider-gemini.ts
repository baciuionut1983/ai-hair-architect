import { GoogleGenAI, Type, type Schema } from "@google/genai";

import {
  ImageAnalysisProvider,
  type AnalysisOptions,
  type FieldConfidence,
  type ImageAnalysisResult,
  type ProviderError,
} from "./image-analysis-provider";

export const GEMINI_PROVIDER_NAME = "gemini";
export const GEMINI_DEFAULT_TIMEOUT_MS = 20_000;

const HAIR_TYPES = ["straight", "wavy", "curly", "coily", "unknown"] as const;
const DENSITIES = ["low", "medium", "high", "unknown"] as const;
const POROSITIES = ["low", "medium", "high", "unknown"] as const;

const UNSUPPORTED_FIELDS = [
  "faceShape",
  "headShape",
  "hairLength",
  "hairTexture",
  "hairCondition",
  "growthPattern",
  "targetShape",
] as const;

const ANALYSIS_PROMPT =
  "Analyze the hair shown in this photo and classify exactly three attributes: " +
  "hairType (one of: straight, wavy, curly, coily, unknown), " +
  "density (one of: low, medium, high, unknown), " +
  "porosity (one of: low, medium, high, unknown). " +
  "Use \"unknown\" only when the photo does not show hair clearly enough to classify " +
  "that attribute, and set that attribute's confidence to 0 in that case. " +
  "Respond with strict JSON matching the provided schema. Do not include any " +
  "commentary, markdown formatting, or fields other than those defined in the schema.";

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    hairType: { type: Type.STRING, enum: [...HAIR_TYPES] },
    density: { type: Type.STRING, enum: [...DENSITIES] },
    porosity: { type: Type.STRING, enum: [...POROSITIES] },
    confidences: {
      type: Type.OBJECT,
      properties: {
        hairType: { type: Type.NUMBER },
        density: { type: Type.NUMBER },
        porosity: { type: Type.NUMBER },
      },
      required: ["hairType", "density", "porosity"],
    },
  },
  required: ["hairType", "density", "porosity", "confidences"],
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
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const rawText = await this.client.generateContent({
        imageBase64: options.imageBuffer.toString("base64"),
        mimeType: options.mimeType,
        model: this.model,
        signal: controller.signal,
      });
      return this.parseAndValidate(rawText);
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
    const allowedTopLevelKeys = new Set(["hairType", "density", "porosity", "confidences"]);
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

    if (!isEnumValue(parsed.hairType, HAIR_TYPES)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed hairType value.");
    }
    if (!isEnumValue(parsed.density, DENSITIES)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed density value.");
    }
    if (!isEnumValue(parsed.porosity, POROSITIES)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed porosity value.");
    }
    const hairType = parsed.hairType;
    const density = parsed.density;
    const porosity = parsed.porosity;

    if (!isPlainObject(parsed.confidences)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed confidences object.");
    }
    const confidenceKeys = new Set(Object.keys(parsed.confidences));
    const allowedConfidenceKeys = new Set(["hairType", "density", "porosity"]);
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

    if (!isValidConfidence(parsed.confidences.hairType)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed hairType confidence value.");
    }
    if (!isValidConfidence(parsed.confidences.density)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed density confidence value.");
    }
    if (!isValidConfidence(parsed.confidences.porosity)) {
      throw this.createProviderError("INVALID_FORMAT", "Gemini response has a malformed porosity confidence value.");
    }
    const hairTypeConfidence = parsed.confidences.hairType;
    const densityConfidence = parsed.confidences.density;
    const porosityConfidence = parsed.confidences.porosity;

    const result: ImageAnalysisResult = {
      hairType,
      density,
      porosity,
      faceShape: null,
      headShape: null,
      hairLength: null,
      hairTexture: null,
      hairCondition: null,
      growthPattern: null,
      targetShape: null,
    };

    const confidences: FieldConfidence = {
      hairType: hairTypeConfidence,
      density: densityConfidence,
      porosity: porosityConfidence,
    };
    for (const field of UNSUPPORTED_FIELDS) {
      confidences[field] = 0;
    }

    return {
      result,
      confidences,
      warnings: ["Automated analysis limited to hairType, density, and porosity (Gemini provider)."],
      limitations: [
        "Cannot determine faceShape, headShape, hairLength, hairTexture, hairCondition, growthPattern, targetShape",
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
    async generateContent({ imageBase64, mimeType, model, signal }: GeminiGenerateContentInput) {
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
      return response.text;
    },
  };
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
