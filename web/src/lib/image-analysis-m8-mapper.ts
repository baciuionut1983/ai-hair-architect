import { ImageAnalysisResult } from '@/lib/image-analysis-provider';

export interface M8MappingOptions {
  analysisResult: ImageAnalysisResult;
  confidences: Record<string, number>;
  unknownFields: string[];
  minimumConfidence?: number;
}

export interface M8Draft {
  hairType: string | null;
  density: string | null;
  porosity: string | null;
  faceShape: string | null;
  headShape: string | null;
  hairLength: string | null;
  hairTexture: string | null;
  hairCondition: string | null;
  growthPattern: string | null;
  targetShape: string | null;
  mappingConfidence: Record<string, number>;
  unmappedFields: string[];
  warnings: string[];
}

export function mapAnalysisToM8Draft(options: M8MappingOptions): M8Draft {
  const { analysisResult, confidences, minimumConfidence = 0.65 } = options;

  const warnings: string[] = [];
  const unmappedFields: string[] = [];

  const mapField = (value: string | null, confidence: number, fieldName: string): string | null => {
    if (value === 'unknown' || value === null) {
      unmappedFields.push(fieldName);
      return null;
    }
    if (confidence < minimumConfidence) {
      warnings.push(`${fieldName}: confidence ${confidence} below threshold ${minimumConfidence}`);
      unmappedFields.push(fieldName);
      return null;
    }
    return String(value);
  };

  const draft: M8Draft = {
    hairType: mapField(analysisResult.hairType, confidences.hairType || 0, 'hairType'),
    density: mapField(analysisResult.density, confidences.density || 0, 'density'),
    porosity: mapField(analysisResult.porosity, confidences.porosity || 0, 'porosity'),
    faceShape: mapField(analysisResult.faceShape, confidences.faceShape || 0, 'faceShape'),
    headShape: mapField(analysisResult.headShape, confidences.headShape || 0, 'headShape'),
    hairLength: mapField(analysisResult.hairLength, confidences.hairLength || 0, 'hairLength'),
    hairTexture: mapField(analysisResult.hairTexture, confidences.hairTexture || 0, 'hairTexture'),
    hairCondition: mapField(analysisResult.hairCondition, confidences.hairCondition || 0, 'hairCondition'),
    growthPattern: mapField(analysisResult.growthPattern, confidences.growthPattern || 0, 'growthPattern'),
    targetShape: mapField(analysisResult.targetShape, confidences.targetShape || 0, 'targetShape'),
    mappingConfidence: confidences,
    unmappedFields,
    warnings,
  };

  return draft;
}
