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

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/professional-brain-skill-templates", () => templatesMock);
vi.mock("@/lib/professional-learning-draft-service", () => serviceMock);
vi.mock("@/lib/professional-learning-mock-extractor", () => ({ mockProfessionalLearningExtractor: { extractorVersion: "mock-deterministic-v1", extract: vi.fn() } }));
vi.mock("@/lib/professional-learning-draft-extraction-validator", () => ({ ProfessionalLearningExtractionValidationError: class extends Error {} }));
vi.mock("@/lib/professional-learning-draft-repository", () => draftRepoMock);
vi.mock("@/lib/professional-learning-evidence-repository", () => evidenceRepoMock);

import { GET, POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invokePost(evidenceId: string): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/learning-evidence/${evidenceId}/drafts`, { method: "POST" }), { params: Promise.resolve({ evidenceId }) });
}
function invokeGet(evidenceId: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/v1/learning-evidence/${evidenceId}/drafts`), { params: Promise.resolve({ evidenceId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
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
