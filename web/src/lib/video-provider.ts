import type { SealedVideoDemonstrationRequest } from "@/lib/video-generation-contracts";

// Real AI Video Demonstration, Stage 1 -- the provider boundary. Mirrors
// photo-preview-provider.ts's own abstract-class + error-code shape, but
// with a genuinely ASYNC two-step contract (submit / poll) instead of a
// single synchronous generate() call -- Video Stage 0 Decision Lock,
// section 5/6: Veo generation takes 11s-6min (documented), so "one call
// does everything" is not an option the way it was for Photo Preview.
//
// This file NEVER makes a real network call on its own -- see
// video-provider-veo.ts for the concrete adapter, and
// video-generation-execution-service.ts for why the DEFAULT (real)
// provider construction path is never reached by any test in this stage.

export interface VideoDemonstrationSourceImageBytes {
  buffer: Buffer;
  mimeType: string;
}

export interface VideoDemonstrationProviderError extends Error {
  code:
    | "TIMEOUT"
    | "MODERATION_REFUSED"
    | "RATE_LIMITED"
    | "INVALID_SOURCE_IMAGE"
    // A well-formed submit/poll response that never actually contained a
    // usable operation identity or a usable video -- distinct from
    // PROVIDER_ERROR (a genuine transport/service failure) and from
    // MODERATION_REFUSED (an explicit safety block). Mirrors Photo
    // Preview's own INVALID_RESPONSE precedent (task §14 there).
    | "INVALID_RESPONSE"
    // The operation id we have on file is unknown to the provider (e.g. it
    // expired, or was never valid) -- distinct from a transient
    // PROVIDER_ERROR: this is a signal that no amount of re-polling will
    // ever succeed, and recovery must fall back to a fresh submission
    // instead (task §12 "stale generation" handling).
    | "OPERATION_NOT_FOUND"
    | "PROVIDER_ERROR"
    | "NOT_CONFIGURED";
  retryable: boolean;
}

export interface VideoDemonstrationSubmitOutcome {
  // Opaque, provider-specific identity for the long-running job -- for Veo,
  // this is the operation's own resource name. Never interpreted or parsed
  // by domain/business code (task §6: no provider-specific logic outside
  // the adapter) -- it is stored and handed back to poll() verbatim.
  providerOperationId: string;
}

export type VideoDemonstrationPollOutcome =
  | { done: false }
  | {
      done: true;
      videoBuffer: Buffer;
      mimeType: string;
      durationSeconds?: number;
    };

export abstract class VideoDemonstrationProvider {
  abstract readonly name: string;
  abstract readonly modelVersion: string;

  // Deliberately takes the SEALED request, never a free-form prompt string
  // -- the concrete adapter builds the actual provider instruction text
  // internally (video-generation-instruction-assembler.ts), never accepts
  // one from outside itself.
  abstract submit(
    sealedRequest: SealedVideoDemonstrationRequest,
    sourceImage: VideoDemonstrationSourceImageBytes,
  ): Promise<VideoDemonstrationSubmitOutcome>;

  // Never submits a new operation -- purely reads the status of an
  // EXISTING one. A FAILED/blocked outcome from the provider throws (never
  // returns `{done: true}` with no video) -- callers distinguish "still
  // running" (`{done: false}`) from "finished successfully"
  // (`{done: true, ...}`) from "finished unsuccessfully" (a thrown
  // VideoDemonstrationProviderError) exactly like Photo Preview's own
  // generate() throw-on-failure convention.
  abstract poll(providerOperationId: string): Promise<VideoDemonstrationPollOutcome>;

  protected createProviderError(
    code: VideoDemonstrationProviderError["code"],
    message: string,
    retryable: boolean = false,
  ): VideoDemonstrationProviderError {
    const err = new Error(message) as VideoDemonstrationProviderError;
    err.code = code;
    err.retryable = retryable;
    return err;
  }
}

// ---------------------------------------------------------------------------
// Deterministic test doubles -- what every Stage 1 test actually exercises.
// ---------------------------------------------------------------------------

// Submits instantly, and "completes" on the very next poll -- returns the
// source bytes back verbatim (a domain-layer test double, never a real
// animation) so calling code can be proven correct against a successful
// outcome shape without a real network call.
export class FakeVideoDemonstrationProvider extends VideoDemonstrationProvider {
  readonly name = "fake-deterministic";
  readonly modelVersion = "fake-1.0";

  async submit(
    _sealedRequest: SealedVideoDemonstrationRequest,
    _sourceImage: VideoDemonstrationSourceImageBytes,
  ): Promise<VideoDemonstrationSubmitOutcome> {
    return { providerOperationId: "fake-operation-id" };
  }

  async poll(_providerOperationId: string): Promise<VideoDemonstrationPollOutcome> {
    return {
      done: true,
      videoBuffer: Buffer.from("fake video bytes"),
      mimeType: "video/mp4",
      durationSeconds: 4,
    };
  }
}

// A fake provider whose submit() always fails -- for exercising
// pre-operation-id failure handling (safely retryable: no operation was
// ever created, so nothing can have been billed).
export class AlwaysFailingSubmitVideoDemonstrationProvider extends VideoDemonstrationProvider {
  readonly name = "fake-always-failing-submit";
  readonly modelVersion = "fake-1.0";

  async submit(): Promise<VideoDemonstrationSubmitOutcome> {
    throw this.createProviderError("PROVIDER_ERROR", "This fake provider always fails to submit.", true);
  }

  async poll(): Promise<VideoDemonstrationPollOutcome> {
    throw this.createProviderError("OPERATION_NOT_FOUND", "This fake provider has no operation to poll.", false);
  }
}

// A fake provider whose poll() always reports "still running" -- for
// exercising the PROCESSING/recovery code path without ever reaching a
// terminal state.
export class AlwaysProcessingVideoDemonstrationProvider extends VideoDemonstrationProvider {
  readonly name = "fake-always-processing";
  readonly modelVersion = "fake-1.0";

  async submit(): Promise<VideoDemonstrationSubmitOutcome> {
    return { providerOperationId: "fake-operation-id-processing" };
  }

  async poll(): Promise<VideoDemonstrationPollOutcome> {
    return { done: false };
  }
}

// A fake provider whose poll() always reports a terminal failure (e.g. a
// moderation block) -- for exercising post-submit failure handling.
export class AlwaysFailingPollVideoDemonstrationProvider extends VideoDemonstrationProvider {
  readonly name = "fake-always-failing-poll";
  readonly modelVersion = "fake-1.0";

  async submit(): Promise<VideoDemonstrationSubmitOutcome> {
    return { providerOperationId: "fake-operation-id-fails-on-poll" };
  }

  async poll(): Promise<VideoDemonstrationPollOutcome> {
    throw this.createProviderError("MODERATION_REFUSED", "This fake provider always reports a moderation block on poll.", false);
  }
}
