import type { AiUsageQuantities } from "@/lib/ai-usage-contracts";
import type { ProfessionalReasoningContext } from "@/lib/professional-reasoning-contracts";

// AI Hair Architect, Professional Skill Engine Stage 5 -- PROFESSIONAL
// REASONING PROVIDER, the provider boundary. Mirrors image-analysis-
// provider.ts's and photo-preview-provider.ts's own exact abstract-class +
// error-code + Fake/Mock-test-double + NOT_IMPLEMENTED-skeleton + factory
// shape -- domain/service code never depends on which concrete model
// eventually answers, exactly like those two existing providers.
//
// reason() returns the RAW, UNVALIDATED model output (`unknown`) -- this
// file deliberately does NOT validate it. Validation is a separate,
// later, mandatory step (professional-reasoning-validator.ts) that never
// trusts raw provider output directly, per Stage 5's own most important
// safety property: "DETERMINISTIC INPUT -> LLM PROPOSAL -> SCHEMA
// VALIDATION -> ... -> PROFESSIONAL REVIEW". A provider that already
// validated its own output would blur that boundary.
//
// Stage 5 explicitly forbids a live paid provider call during
// implementation/automated testing -- every implementation in THIS file
// is either a deterministic test double or a skeleton that structurally
// cannot invoke production (no LLM SDK is imported anywhere in this file;
// that import is deferred to whichever stage separately authorizes a real
// call, mirroring GeminiPhotoPreviewProviderSkeleton's own exact
// "structurally impossible to reach the network by mistake" discipline).

export interface ProfessionalReasoningProviderError extends Error {
  code: "TIMEOUT" | "RATE_LIMITED" | "MODERATION_REFUSED" | "INVALID_RESPONSE" | "PROVIDER_ERROR" | "NOT_CONFIGURED" | "NOT_IMPLEMENTED";
  retryable: boolean;
}

export interface ProfessionalReasoningProviderOutcome {
  // Deliberately `unknown` -- see file header. The caller (professional-
  // reasoning-validator.ts, via professional-reasoning-service.ts) is the
  // ONLY place this is ever trusted, and only after full validation.
  rawProposal: unknown;
  providerRequestId?: string;
  usage?: AiUsageQuantities;
}

export abstract class ProfessionalReasoningProvider {
  abstract readonly name: string;
  abstract readonly modelVersion: string;

  abstract reason(context: ProfessionalReasoningContext): Promise<ProfessionalReasoningProviderOutcome>;

  protected createProviderError(code: ProfessionalReasoningProviderError["code"], message: string, retryable: boolean = false): ProfessionalReasoningProviderError {
    const err = new Error(message) as ProfessionalReasoningProviderError;
    err.code = code;
    err.retryable = retryable;
    return err;
  }
}

// ---------------------------------------------------------------------------
// Deterministic test doubles -- the only implementations any Stage 5 test
// exercises (Part J's own explicit "mock provider only in automated
// suite" rule).
// ---------------------------------------------------------------------------

// Returns a caller-supplied canned response verbatim -- lets adversarial
// tests construct any raw shape (well-formed, malformed, or maliciously
// non-compliant) without needing a real network call.
export class FakeProfessionalReasoningProvider extends ProfessionalReasoningProvider {
  readonly name = "fake-deterministic";
  readonly modelVersion = "fake-1.0";

  constructor(private readonly cannedResponse: unknown) {
    super();
  }

  async reason(_context: ProfessionalReasoningContext): Promise<ProfessionalReasoningProviderOutcome> {
    return { rawProposal: this.cannedResponse, providerRequestId: "fake-request-id", usage: { outputTokens: 128 } };
  }
}

export class AlwaysFailingProfessionalReasoningProvider extends ProfessionalReasoningProvider {
  readonly name = "fake-always-failing";
  readonly modelVersion = "fake-1.0";

  async reason(_context: ProfessionalReasoningContext): Promise<ProfessionalReasoningProviderOutcome> {
    throw this.createProviderError("PROVIDER_ERROR", "This fake provider always fails.", true);
  }
}

// ---------------------------------------------------------------------------
// LLM adapter skeleton -- structurally present (a real provider slots into
// this exact interface later) but CANNOT accidentally invoke production:
// reason() unconditionally throws NOT_IMPLEMENTED before touching any
// network client, API key, or SDK. Deliberately provider-NEUTRAL naming
// (not "Gemini"/"OpenAI"/"Claude" specifically) -- task's own explicit
// "domain logic must not depend on provider-specific response shape";
// the concrete vendor is an implementation-time choice for whichever
// stage separately authorizes the first real call, not an architectural
// commitment made here.
// ---------------------------------------------------------------------------

export class LlmProfessionalReasoningProviderSkeleton extends ProfessionalReasoningProvider {
  readonly name: string;

  constructor(
    name: string,
    readonly modelVersion: string,
  ) {
    super();
    this.name = name;
  }

  async reason(_context: ProfessionalReasoningContext): Promise<ProfessionalReasoningProviderOutcome> {
    throw this.createProviderError(
      "NOT_IMPLEMENTED",
      "The real Professional Reasoning provider adapter is not implemented yet (Stage 5 foundation is deterministic + mocked only; no paid provider call is authorized).",
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory -- mirrors getPhotoPreviewProvider's/getProvider's own shape.
// Stage 5 never resolves to a real provider: any unrecognized name, or no
// name at all, resolves to a safe, non-network implementation.
// ---------------------------------------------------------------------------

export function getProfessionalReasoningProvider(providerName: string | undefined, modelVersion: string, cannedResponseForFake?: unknown): ProfessionalReasoningProvider {
  if (providerName === "fake-deterministic") {
    return new FakeProfessionalReasoningProvider(cannedResponseForFake);
  }
  if (providerName === "fake-always-failing") {
    return new AlwaysFailingProfessionalReasoningProvider();
  }
  return new LlmProfessionalReasoningProviderSkeleton(providerName ?? "unconfigured", modelVersion);
}
