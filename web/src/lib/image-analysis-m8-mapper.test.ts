import { describe, it, expect } from 'vitest';
import { mapAnalysisToM8Draft } from './image-analysis-m8-mapper';

describe('Image Analysis to M8 Mapping', () => {
  it('maps high confidence values', () => {
    const draft = mapAnalysisToM8Draft({
      analysisResult: {
        hairType: 'wavy',
        density: 'high',
        porosity: 'medium',
        faceShape: null,
        headShape: null,
        hairLength: null,
        hairTexture: null,
        hairCondition: null,
        growthPattern: null,
        targetShape: null,
      },
      confidences: {
        hairType: 0.85,
        density: 0.90,
        porosity: 0.75,
      },
      unknownFields: [],
      minimumConfidence: 0.65,
    });

    expect(draft.hairType).toBe('wavy');
    expect(draft.density).toBe('high');
    expect(draft.porosity).toBe('medium');
  });

  it('excludes low confidence values', () => {
    const draft = mapAnalysisToM8Draft({
      analysisResult: {
        hairType: 'wavy',
        density: 'high',
        porosity: 'medium',
        faceShape: null,
        headShape: null,
        hairLength: null,
        hairTexture: null,
        hairCondition: null,
        growthPattern: null,
        targetShape: null,
      },
      confidences: {
        hairType: 0.5,
        density: 0.45,
        porosity: 0.75,
      },
      unknownFields: [],
      minimumConfidence: 0.65,
    });

    expect(draft.hairType).toBeNull();
    expect(draft.density).toBeNull();
    expect(draft.porosity).toBe('medium');
    expect(draft.unmappedFields).toContain('hairType');
    expect(draft.unmappedFields).toContain('density');
  });

  it('handles unknown values', () => {
    const draft = mapAnalysisToM8Draft({
      analysisResult: {
        hairType: 'unknown',
        density: 'unknown',
        porosity: 'medium',
        faceShape: null,
        headShape: null,
        hairLength: null,
        hairTexture: null,
        hairCondition: null,
        growthPattern: null,
        targetShape: null,
      },
      confidences: {
        hairType: 0.85,
        density: 0.90,
        porosity: 0.75,
      },
      unknownFields: ['hairType', 'density'],
      minimumConfidence: 0.65,
    });

    expect(draft.hairType).toBeNull();
    expect(draft.density).toBeNull();
    expect(draft.unmappedFields).toContain('hairType');
    expect(draft.unmappedFields).toContain('density');
  });
});
