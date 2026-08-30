import type { AiUsageQuantities } from '@/lib/ai-usage-contracts';
import type { SealedPhotoPreviewRequest } from '@/lib/photo-preview-contracts';

// Real AI Photo Preview, Stage 1 -- the provider boundary. Mirrors
// image-analysis-provider.ts's own abstract-class + error-code shape
// exactly, so a future Gemini adapter (and, later, any other provider)
// slots into the same domain/repository code the way ImageAnalysisProvider
// already does for vision analysis.
//
// Stage 1 explicitly forbids a live paid provider call (task, top-level
// prohibitions). Every implementation in THIS file is either a deterministic
// test double or a skeleton that structurally cannot invoke production --
// see GeminiPhotoPreviewProviderSkeleton's own doc comment below.

export interface PhotoPreviewSourceImageBytes {
  buffer: Buffer;
  mimeType: string;
}

export interface PhotoPreviewProviderError extends Error {
  code:
    | 'TIMEOUT'
    | 'MODERATION_REFUSED'
    | 'RATE_LIMITED'
    | 'INVALID_SOURCE_IMAGE'
    // Real AI Photo Preview, Stage 2 -- a well-formed response that never
    // actually contained the requested image (no candidate, no inlineData
    // part anywhere, or malformed content) -- distinct from PROVIDER_ERROR
    // (a genuine transport/service failure) and from MODERATION_REFUSED (an
    // explicit safety block) -- task §14/§31's own required "response with
    // no image rejected" case.
    | 'INVALID_RESPONSE'
    | 'PROVIDER_ERROR'
    | 'NOT_CONFIGURED'
    | 'NOT_IMPLEMENTED';
  retryable: boolean;
}

export interface PhotoPreviewGenerationOutcome {
  // Raw generated image bytes -- Stage 1 never persists these (task §16/§22:
  // no fake worker, no real provider output yet); a real Stage 2 adapter
  // would hand this to the existing durable object-storage pipeline.
  imageBuffer: Buffer;
  mimeType: string;
  providerRequestId?: string;
  // Absent whenever the provider call never exposed real usage metadata --
  // mirrors AiUsageQuantities's own "never fabricate a zero" convention
  // (ai-usage-contracts.ts) exactly. The real, provider-neutral shape
  // (Real AI Photo Preview, Stage 2's Gemini adapter populates real token
  // counts here via gemini-usage-mapper.ts, plus imageCount when an image
  // was actually produced -- never a fabricated count).
  usage?: AiUsageQuantities;
}

export abstract class PhotoPreviewProvider {
  abstract readonly name: string;
  abstract readonly modelVersion: string;

  // Deliberately takes the SEALED request, never a free-form prompt string
  // (task §10/§12) -- the boundary between "provider-independent structured
  // intent" and "provider-specific instruction text" is that instruction
  // text is constructed INSIDE a concrete adapter's own generate()
  // implementation, never passed in from outside it.
  abstract generate(
    sealedRequest: SealedPhotoPreviewRequest,
    sourceImage: PhotoPreviewSourceImageBytes,
  ): Promise<PhotoPreviewGenerationOutcome>;

  protected createProviderError(
    code: PhotoPreviewProviderError['code'],
    message: string,
    retryable: boolean = false,
  ): PhotoPreviewProviderError {
    const err = new Error(message) as PhotoPreviewProviderError;
    err.code = code;
    err.retryable = retryable;
    return err;
  }
}

// ---------------------------------------------------------------------------
// Deterministic test double -- the only implementation any Stage 1 test
// exercises. Mirrors MockDeterministicProvider's own "deterministic from
// input bytes, never a real network call" shape.
// ---------------------------------------------------------------------------

export class FakePhotoPreviewProvider extends PhotoPreviewProvider {
  readonly name = 'fake-deterministic';
  readonly modelVersion = 'fake-1.0';

  async generate(
    _sealedRequest: SealedPhotoPreviewRequest,
    sourceImage: PhotoPreviewSourceImageBytes,
  ): Promise<PhotoPreviewGenerationOutcome> {
    // Returns the source bytes back verbatim -- this is a domain-layer test
    // double, never a real edit; it exists only to prove the calling code
    // handles a successful outcome shape correctly.
    return {
      imageBuffer: sourceImage.buffer,
      mimeType: sourceImage.mimeType,
      providerRequestId: 'fake-request-id',
      usage: { imageCount: 1 },
    };
  }
}

// A fake provider that always fails -- for exercising failure-handling code
// paths without needing a real provider outage.
export class AlwaysFailingPhotoPreviewProvider extends PhotoPreviewProvider {
  readonly name = 'fake-always-failing';
  readonly modelVersion = 'fake-1.0';

  async generate(
    _sealedRequest: SealedPhotoPreviewRequest,
    _sourceImage: PhotoPreviewSourceImageBytes,
  ): Promise<PhotoPreviewGenerationOutcome> {
    throw this.createProviderError('PROVIDER_ERROR', 'This fake provider always fails.', true);
  }
}

// ---------------------------------------------------------------------------
// Gemini adapter skeleton -- structurally present (so the provider boundary
// is real, testable, and the eventual Stage 2 implementation has an exact
// slot to fill in) but CANNOT accidentally invoke production: generate()
// unconditionally throws a NOT_IMPLEMENTED error before touching any
// network client, API key, or SDK. No Gemini SDK is imported by this file
// at all -- that import itself is deferred to whichever Stage actually
// authorizes a real call, so it is structurally impossible for Stage 1 code
// to reach the network even by mistake.
// ---------------------------------------------------------------------------

export class GeminiPhotoPreviewProviderSkeleton extends PhotoPreviewProvider {
  readonly name = 'gemini';

  constructor(readonly modelVersion: string) {
    super();
  }

  async generate(
    _sealedRequest: SealedPhotoPreviewRequest,
    _sourceImage: PhotoPreviewSourceImageBytes,
  ): Promise<PhotoPreviewGenerationOutcome> {
    throw this.createProviderError(
      'NOT_IMPLEMENTED',
      'The Gemini Photo Preview adapter is not implemented yet (Stage 1 is domain/architecture only; no paid provider call is authorized).',
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory -- mirrors image-analysis-provider.ts's own getProvider() shape.
// Stage 1 never resolves to a real provider: an unrecognized or "gemini"
// name both resolve to safe, non-network implementations, matching the
// config resolver's own fail-closed "disabled by default" posture
// (photo-preview-provider-config.ts).
// ---------------------------------------------------------------------------

export function getPhotoPreviewProvider(providerName: string | undefined, modelVersion: string): PhotoPreviewProvider {
  if (providerName === 'fake-deterministic') {
    return new FakePhotoPreviewProvider();
  }
  if (providerName === 'gemini') {
    return new GeminiPhotoPreviewProviderSkeleton(modelVersion);
  }
  return new FakePhotoPreviewProvider();
}
