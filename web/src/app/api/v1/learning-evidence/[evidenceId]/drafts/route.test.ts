import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const templatesMock = vi.hoisted(() => ({ buildCanonicalCandidateSkillRegistry: vi.fn(() => []) }));
const serviceMock = vi.hoisted(() => {
  class ProfessionalLearningDraftServiceError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { processEvidenceIntoDraft: vi.fn(), ProfessionalLearningDraftServiceError };
});
const draftRepoMock = vi.hoisted(() => ({
  listDraftsForOwner: vi.fn(),
  isProfessionalLearningDraftPersistenceError: vi.fn(() => false),
  professionalLearningDraftPersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "UNAVAILABLE" }, { status: 503 })),
}));
const evidenceRepoMock = vi.hoisted(() => ({
  isProfessionalLearningEvidencePersistenceError: vi.fn(() => false),
  professionalLearningEvidencePersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "UNAVAILABLE" }, { status: 503 })),
}));
// Stage 8.5T1.1 -- mirrors professional-learning-extractor-selection.ts's
// own tiny, pure shapes exactly (same discipline this file already uses
// for ProfessionalLearningDraftServiceError above) -- this is a route-
// level test double, never a second source of truth for the real logic
// (that logic has its own dedicated, unmocked test file).
const extractorSelectionMock = vi.hoisted(() => {
  class ProfessionalLearningExtractorSelectionError extends Error {
    readonly code = "REAL_EXTRACTION_MISCONFIGURED";
    readonly httpStatus = 503;
    constructor(reason: string) {
      super(`Real professional-learning extraction is enabled but misconfigured: ${reason}`);
    }
  }
  const PROVIDER_ERROR_CODES = new Set(["TIMEOUT", "RATE_LIMITED", "INVALID_RESPONSE", "PROVIDER_ERROR", "NOT_CONFIGURED"]);
  return {
    selectProfessionalLearningExtractor: vi.fn(() => ({ extractorVersion: "mock-deterministic-v1", extract: vi.fn() })),
    ProfessionalLearningExtractorSelectionError,
    isProfessionalLearningExtractorProviderError: (error: unknown): error is Error & { code: string } => {
      if (!(error instanceof Error)) return false;
      const code = (error as Error & { code?: unknown }).code;
      return typeof code === "string" && PROVIDER_ERROR_CODES.has(code);
    },
    professionalLearningExtractorProviderErrorHttpStatus: (error: { code: string }) => {
      switch (error.code) {
        case "TIMEOUT":
          return 504;
        case "RATE_LIMITED":
          return 429;
        case "NOT_CONFIGURED":
          return 503;
        default:
          return 502;
      }
    },
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/professional-brain-skill-templates", () => templatesMock);
vi.mock("@/lib/professional-learning-draft-service", () => serviceMock);
vi.mock("@/lib/professional-learning-extractor-selection", () => extractorSelectionMock);
vi.mock("@/lib/professional-learning-draft-extraction-validator", () => ({ ProfessionalLearningExtractionValidationError: class extends Error {} }));
vi.mock("@/lib/professional-learning-draft-repository", () => draftRepoMock);
vi.mock("@/lib/professional-learning-evidence-repository", () => evidenceRepoMock);

import { GET, POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invokePost(evidenceId: string, body?: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/learning-evidence/${evidenceId}/drafts`, {
      method: "POST",
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ evidenceId }) },
  );
}
function invokeGet(evidenceId: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/v1/learning-evidence/${evidenceId}/drafts`), { params: Promise.resolve({ evidenceId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
  // Re-established every test (mockReturnValue/mockImplementation persist
  // across vi.clearAllMocks(), same reasoning as checkRateLimit's own
  // default above) -- a test that overrides this for its own scenario
  // (e.g. the misconfigured/provider-error tests below) never leaks into
  // the next test.
  extractorSelectionMock.selectProfessionalLearningExtractor.mockReturnValue({ extractorVersion: "mock-deterministic-v1", extract: vi.fn() });
});

describe("POST /api/v1/learning-evidence/[evidenceId]/drafts", () => {
  it("returns 401 without an authenticated session, and never calls the pipeline", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await invokePost("evidence-1");
    expect(response.status).toBe(401);
    expect(serviceMock.processEvidenceIntoDraft).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited, before touching the pipeline", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    const response = await invokePost("evidence-1");
    expect(response.status).toBe(429);
    expect(serviceMock.processEvidenceIntoDraft).not.toHaveBeenCalled();
  });

  it("returns 201 with the created draft on success", async () => {
    const draft = { id: "draft-1", status: "DRAFT" };
    serviceMock.processEvidenceIntoDraft.mockResolvedValue({ kind: "created", draft });
    const response = await invokePost("evidence-1");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ status: "created", draft });
    expect(serviceMock.processEvidenceIntoDraft).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", evidenceId: "evidence-1" }),
    );
  });

  // Stage 8.5T1.1 -- the extractor is resolved per-request via
  // selectProfessionalLearningExtractor(process.env), never hardcoded to
  // the mock, and never constructed inline in the route.
  it("resolves the extractor via selectProfessionalLearningExtractor and passes it straight through to the pipeline", async () => {
    const resolvedExtractor = { extractorVersion: "gemini-real-v1:gemini-3.6-flash", extract: vi.fn() };
    extractorSelectionMock.selectProfessionalLearningExtractor.mockReturnValue(resolvedExtractor);
    serviceMock.processEvidenceIntoDraft.mockResolvedValue({ kind: "created", draft: { id: "draft-1" } });

    await invokePost("evidence-1");

    expect(extractorSelectionMock.selectProfessionalLearningExtractor).toHaveBeenCalledWith(process.env);
    expect(serviceMock.processEvidenceIntoDraft).toHaveBeenCalledWith(expect.objectContaining({ extractor: resolvedExtractor }));
  });

  // Stage 8.5T1.1 -- FAIL CLOSED: real extraction explicitly enabled but
  // misconfigured must surface as a real, visible failure, never a
  // silent fallback to a mock-shaped "insufficient evidence" success.
  it("fails closed with 503 when real extraction is enabled but misconfigured, and never calls the pipeline", async () => {
    extractorSelectionMock.selectProfessionalLearningExtractor.mockImplementation(() => {
      throw new extractorSelectionMock.ProfessionalLearningExtractorSelectionError("AI_ANALYSIS_PROVIDER is not configured.");
    });
    const response = await invokePost("evidence-1");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("REAL_EXTRACTION_MISCONFIGURED");
    expect(serviceMock.processEvidenceIntoDraft).not.toHaveBeenCalled();
  });

  // Stage 8.5T1.1 -- a real Gemini provider failure during extraction
  // (thrown from inside processEvidenceIntoDraft, since that is where
  // extractor.extract() is actually invoked) must fail honestly with the
  // status matching its own error code -- never a fabricated successful
  // draft.
  it.each([
    ["TIMEOUT", 504],
    ["RATE_LIMITED", 429],
    ["NOT_CONFIGURED", 503],
    ["PROVIDER_ERROR", 502],
    ["INVALID_RESPONSE", 502],
  ])("maps a real provider error with code %s to status %i, never a fabricated success", async (code, expectedStatus) => {
    const providerError = Object.assign(new Error(`provider failed: ${code}`), { code, retryable: false });
    serviceMock.processEvidenceIntoDraft.mockRejectedValue(providerError);
    const response = await invokePost("evidence-1");
    expect(response.status).toBe(expectedStatus);
    const body = await response.json();
    expect(body.error).toBe(code);
    expect(body.message).not.toMatch(/api[_-]?key/i);
  });

  it("returns 200 with a skipped status and reason when the relevance gate declines to process", async () => {
    serviceMock.processEvidenceIntoDraft.mockResolvedValue({ kind: "skipped", reason: "EMPTY_TRANSCRIPT" });
    const response = await invokePost("evidence-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "skipped", reason: "EMPTY_TRANSCRIPT" });
  });

  it("maps a service error to its declared httpStatus", async () => {
    serviceMock.processEvidenceIntoDraft.mockRejectedValue(new serviceMock.ProfessionalLearningDraftServiceError("EVIDENCE_NOT_FOUND", 404, "not found"));
    const response = await invokePost("evidence-1");
    expect(response.status).toBe(404);
  });

  // T1.2.R1 -- EXPLICIT REANALYSIS SEMANTICS.
  it("defaults to mode=ANALYZE when no body/mode is sent -- existing callers keep their exact current behavior", async () => {
    serviceMock.processEvidenceIntoDraft.mockResolvedValue({ kind: "created", draft: { id: "draft-1" } });
    await invokePost("evidence-1");
    expect(serviceMock.processEvidenceIntoDraft).toHaveBeenCalledWith(expect.objectContaining({ mode: "ANALYZE" }));
  });

  it("passes mode=REANALYZE straight through only when the caller explicitly sends it", async () => {
    serviceMock.processEvidenceIntoDraft.mockResolvedValue({ kind: "reanalyzed", draft: { id: "draft-1" } });
    const response = await invokePost("evidence-1", { mode: "REANALYZE" });
    expect(serviceMock.processEvidenceIntoDraft).toHaveBeenCalledWith(expect.objectContaining({ mode: "REANALYZE" }));
    expect(response.status).toBe(200);
    const returned = await response.json();
    expect(returned.status).toBe("reanalyzed");
  });

  it.each(["reanalyze", "force", "", null, 123, { nested: true }])(
    "never trusts an arbitrary/malformed mode value (%j) as a bypass -- falls back to the safe ANALYZE default",
    async (malformedMode) => {
      serviceMock.processEvidenceIntoDraft.mockResolvedValue({ kind: "created", draft: { id: "draft-1" } });
      await invokePost("evidence-1", { mode: malformedMode });
      expect(serviceMock.processEvidenceIntoDraft).toHaveBeenCalledWith(expect.objectContaining({ mode: "ANALYZE" }));
    },
  );

  it("a REANALYZE conflict (already in progress / not reanalyzable) maps to its declared 409, exactly like any other service error", async () => {
    serviceMock.processEvidenceIntoDraft.mockRejectedValue(new serviceMock.ProfessionalLearningDraftServiceError("DRAFT_REANALYSIS_IN_PROGRESS", 409, "in progress"));
    const response = await invokePost("evidence-1", { mode: "REANALYZE" });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("DRAFT_REANALYSIS_IN_PROGRESS");
  });

  // Stage 8.5T1.1 (task requirement #7): connecting real extraction must
  // never also wire in active-knowledge assimilation -- this route's own
  // source never imports ProfessionalKnowledgeEntry/assimilation/registry-
  // write modules, regardless of which extractor is selected.
  it("STATIC: the route source never imports ProfessionalKnowledgeEntry/assimilation/skill-mutation modules", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/api/v1/learning-evidence/[evidenceId]/drafts/route.ts"), "utf8");
    expect(source).not.toMatch(/professional-knowledge-entry-contracts/);
    expect(source).not.toMatch(/professional-knowledge-assimilation/);
    expect(source).not.toMatch(/professional-knowledge-activation/);
    expect(source).not.toMatch(/professional-knowledge-registry\b/);
    expect(source).not.toMatch(/professionalSkillDefinition\.(create|update|upsert)/);
  });

  // Task requirement #6: authorization/purpose semantics are unchanged --
  // the 401 test above already proves unauthenticated requests never
  // reach the pipeline; this proves an authenticated request is always
  // scoped to that exact session's own user id, regardless of which
  // extractor gets selected.
  it("always scopes processEvidenceIntoDraft to the authenticated session's own ownerUserId, never a caller-supplied id", async () => {
    serviceMock.processEvidenceIntoDraft.mockResolvedValue({ kind: "created", draft: { id: "draft-1" } });
    await invokePost("evidence-1");
    expect(serviceMock.processEvidenceIntoDraft).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: OWNER.id }));
  });
});

describe("GET /api/v1/learning-evidence/[evidenceId]/drafts", () => {
  it("returns 401 without an authenticated session", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await invokeGet("evidence-1");
    expect(response.status).toBe(401);
  });

  it("lists drafts scoped to the authenticated owner and the given evidenceId", async () => {
    draftRepoMock.listDraftsForOwner.mockResolvedValue([{ id: "draft-1" }]);
    const response = await invokeGet("evidence-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ drafts: [{ id: "draft-1" }] });
    expect(draftRepoMock.listDraftsForOwner).toHaveBeenCalledWith("owner-1", { sourceEvidenceId: "evidence-1" });
  });
});
