export interface ImageAnalysisResult {
  hairType: 'straight' | 'wavy' | 'curly' | 'coily' | 'unknown';
  density: 'low' | 'medium' | 'high' | 'unknown';
  porosity: 'low' | 'medium' | 'high' | 'unknown';
  faceShape: string | null;
  headShape: string | null;
  hairLength: string | null;
  hairTexture: string | null;
  hairCondition: string | null;
  growthPattern: string | null;
  targetShape: string | null;
}

export interface FieldConfidence {
  [key: string]: number;
}

export interface ProviderError extends Error {
  code: 'TIMEOUT' | 'INVALID_FORMAT' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'NOT_CONFIGURED';
  retryable: boolean;
}

export interface AnalysisOptions {
  imageBuffer: Buffer;
  mimeType: string;
  userId: string;
  clientId: string;
}

export abstract class ImageAnalysisProvider {
  abstract readonly name: string;
  abstract readonly modelVersion: string;

  abstract analyze(options: AnalysisOptions): Promise<{
    result: ImageAnalysisResult;
    confidences: FieldConfidence;
    warnings: string[];
    limitations: string[];
  }>;

  protected createProviderError(
    code: ProviderError['code'],
    message: string,
    retryable: boolean = false
  ): ProviderError {
    const err = new Error(message) as ProviderError;
    err.code = code;
    err.retryable = retryable;
    return err;
  }
}

export class MockDeterministicProvider extends ImageAnalysisProvider {
  readonly name = 'mock-deterministic';
  readonly modelVersion = 'mock-1.0';

  async analyze(options: AnalysisOptions) {
    const buffer = options.imageBuffer;
    const hash = this.simpleHash(buffer);

    const scenarios: Record<string, Partial<ImageAnalysisResult>> = {
      '0': { hairType: 'wavy', density: 'medium', porosity: 'medium' },
      '1': { hairType: 'curly', density: 'high', porosity: 'high' },
      '2': { hairType: 'straight', density: 'low', porosity: 'low' },
      '3': { hairType: 'coily', density: 'high', porosity: 'medium' },
    };

    const scenario = scenarios[(hash % 4).toString()] || scenarios['0'];
    const result: ImageAnalysisResult = {
      hairType: (scenario.hairType || 'unknown') as ImageAnalysisResult['hairType'],
      density: (scenario.density || 'unknown') as ImageAnalysisResult['density'],
      porosity: (scenario.porosity || 'unknown') as ImageAnalysisResult['porosity'],
      faceShape: null,
      headShape: null,
      hairLength: null,
      hairTexture: null,
      hairCondition: null,
      growthPattern: null,
      targetShape: null,
    };

    return {
      result,
      confidences: {
        hairType: 0.85,
        density: 0.72,
        porosity: 0.68,
        faceShape: 0,
        headShape: 0,
        hairLength: 0,
        hairTexture: 0,
        hairCondition: 0,
        growthPattern: 0,
        targetShape: 0,
      },
      warnings: ['Limited visual analysis (mock provider)'],
      limitations: [
        'Cannot determine faceShape, headShape, hairLength, hairTexture, hairCondition, growthPattern, targetShape',
        'Confidence scores below 0.7 require manual verification',
      ],
    };
  }

  private simpleHash(buffer: Buffer): number {
    let hash = 0;
    for (let i = 0; i < Math.min(buffer.length, 1000); i++) {
      hash = ((hash << 5) - hash) + buffer[i];
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

export class ManualOnlyProvider extends ImageAnalysisProvider {
  readonly name = 'manual-only';
  readonly modelVersion = 'manual-1.0';

  async analyze(): Promise<{
    result: ImageAnalysisResult;
    confidences: FieldConfidence;
    warnings: string[];
    limitations: string[];
  }> {
    return {
      result: {
        hairType: 'unknown',
        density: 'unknown',
        porosity: 'unknown',
        faceShape: null,
        headShape: null,
        hairLength: null,
        hairTexture: null,
        hairCondition: null,
        growthPattern: null,
        targetShape: null,
      },
      confidences: {
        hairType: 0,
        density: 0,
        porosity: 0,
        faceShape: 0,
        headShape: 0,
        hairLength: 0,
        hairTexture: 0,
        hairCondition: 0,
        growthPattern: 0,
        targetShape: 0,
      },
      warnings: ['Manual review required for all fields'],
      limitations: ['No automated analysis available; awaiting human input'],
    };
  }
}

export function getProvider(providerName?: string): ImageAnalysisProvider {
  if (providerName === 'mock-deterministic') {
    return new MockDeterministicProvider();
  }
  return new ManualOnlyProvider();
}
