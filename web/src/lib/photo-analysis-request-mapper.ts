import {
  DENSITY_OPTIONS,
  FACE_SHAPE_OPTIONS,
  GROWTH_PATTERN_OPTIONS,
  HAIR_CONDITION_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  HAIR_TEXTURE_OPTIONS,
  HEAD_SHAPE_OPTIONS,
  POROSITY_OPTIONS,
  TARGET_SHAPE_OPTIONS
} from "@/lib/analysis-field-options";
import type { AnalysisEngineInput } from "@/lib/milestone2-types";
import type { ImageAnalysisResult } from "@/lib/image-analysis-provider";

const VALID_DENSITIES = DENSITY_OPTIONS.map((option) => option.value);
const VALID_POROSITIES = POROSITY_OPTIONS.map((option) => option.value);
const VALID_HAIR_TEXTURES = HAIR_TEXTURE_OPTIONS.map((option) => option.value);
const VALID_FACE_SHAPES = FACE_SHAPE_OPTIONS.map((option) => option.value);
const VALID_HEAD_SHAPES = HEAD_SHAPE_OPTIONS.map((option) => option.value);
const VALID_HAIR_LENGTHS = HAIR_LENGTH_OPTIONS.map((option) => option.value);
const VALID_HAIR_CONDITIONS = HAIR_CONDITION_OPTIONS.map((option) => option.value);
const VALID_GROWTH_PATTERNS = GROWTH_PATTERN_OPTIONS.map((option) => option.value);
const VALID_TARGET_SHAPES = TARGET_SHAPE_OPTIONS.map((option) => option.value);

export type PhotoMappedFields = Omit<AnalysisEngineInput, "goal" | "hairType">;

/**
 * M31 GO-4: the photo pipeline's ImageAnalysisResult.hairType carries
 * texture values (straight/wavy/curly/coily/unknown), not the thickness
 * values (fine/medium/coarse) AnalysisRequest.hairType requires -- so it
 * maps to hairTexture here, never to hairType. hairType (thickness) and
 * goal are never derivable from a photo; the caller must supply them from
 * a manual step. density/porosity map through when the AI provided a real
 * value; "unknown" or anything else is left undefined so the caller knows
 * to ask the user instead of silently guessing.
 */
export function mapPhotoAnalysisToRequestFields(analysisResult: ImageAnalysisResult): PhotoMappedFields {
  return {
    density: pickEnum(analysisResult.density, VALID_DENSITIES),
    porosity: pickEnum(analysisResult.porosity, VALID_POROSITIES),
    hairTexture: pickEnum(analysisResult.hairType, VALID_HAIR_TEXTURES),
    faceShape: pickEnum(analysisResult.faceShape, VALID_FACE_SHAPES),
    headShape: pickEnum(analysisResult.headShape, VALID_HEAD_SHAPES),
    hairLength: pickEnum(analysisResult.hairLength, VALID_HAIR_LENGTHS),
    hairCondition: pickEnum(analysisResult.hairCondition, VALID_HAIR_CONDITIONS),
    growthPattern: pickEnum(analysisResult.growthPattern, VALID_GROWTH_PATTERNS),
    targetShape: pickEnum(analysisResult.targetShape, VALID_TARGET_SHAPES)
  } as PhotoMappedFields;
}

function pickEnum<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
