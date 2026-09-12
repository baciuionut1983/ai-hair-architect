import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const evidenceRepoMock = vi.hoisted(() => {
  class ProfessionalLearningEvidenceValidationError extends Error {
    readonly httpStatus = 400;
    constructor(message: string) {
      super(message);
    }
  }
  return {
    createLearningEvidence: vi.fn(),
    isProfessionalLearningEvidencePersistenceError: vi.fn(() => false),
    professionalLearningEvidencePersistenceUnavailableResponse: vi.fn(() =>
      Response.json({ error: "PROFESSIONAL_LEARNING_EVIDENCE_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
    ),
    ProfessionalLearningEvidenceValidationError,
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/professional-learning-evidence-repository", () => evidenceRepoMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function invokePost(id: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/clients/${id}/learning-evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  evidenceRepoMock.createLearningEvidence.mockResolvedValue({
    id: "evidence-1",
    evidenceType: "TEXT",
    vertical: "unspecified",
    status: "ACTIVE",
    title: null,
    createdAt: "2026-09-12T10:00:00.000Z",
  });
  evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/clients/[id]/learning-evidence", () => {
  it("1/8. returns 401 without a cookie, touching nothing else -- owner is never accepted from the client", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invokePost("client-1", { evidenceType: "TEXT", content: "x" });

    expect(response.status).toBe(401);
    expect(evidenceRepoMock.createLearningEvidence).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invokePost("client-1", { evidenceType: "TEXT", content: "x" });

    expect(response.status).toBe(429);
    expect(evidenceRepoMock.createLearningEvidence).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client context, before any evidence logic runs", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invokePost("foreign-client", { evidenceType: "TEXT", content: "x" });

    expect(response.status).toBe(404);
    expect(evidenceRepoMock.createLearningEvidence).not.toHaveBeenCalled();
  });

  it("returns 400 for an evidenceType other than TEXT/VOICE_TRANSCRIPT", async () => {
    const response = await invokePost("client-1", { evidenceType: "IMAGE", content: "x" });
    expect(response.status).toBe(400);
    expect(evidenceRepoMock.createLearningEvidence).not.toHaveBeenCalled();
  });

  it("returns 400 for empty or overlong content", async () => {
    const empty = await invokePost("client-1", { evidenceType: "TEXT", content: "   " });
    expect(empty.status).toBe(400);

    const overlong = await invokePost("client-1", { evidenceType: "TEXT", content: "x".repeat(4001) });
    expect(overlong.status).toBe(400);

    expect(evidenceRepoMock.createLearningEvidence).not.toHaveBeenCalled();
  });

  it("2. returns 400 for VOICE_TRANSCRIPT with no transcriptId -- voice evidence can only follow a real reviewed transcript", async () => {
    const response = await invokePost("client-1", { evidenceType: "VOICE_TRANSCRIPT", content: "spoken note" });
    expect(response.status).toBe(400);
    expect(evidenceRepoMock.createLearningEvidence).not.toHaveBeenCalled();
  });

  it("1. creates TEXT evidence with the authenticated user as owner, never a client-supplied one", async () => {
    await invokePost("client-1", { evidenceType: "TEXT", content: "Graduation notes." });

    expect(evidenceRepoMock.createLearningEvidence).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ evidenceType: "TEXT", originalText: "Graduation notes.", vertical: "unspecified" }),
      expect.anything(),
    );
  });

  it("7. never allows visibilityScope/rightsClassification to be supplied by the caller -- always the server default", async () => {
    await invokePost("client-1", { evidenceType: "TEXT", content: "x", visibilityScope: "PUBLIC", rightsClassification: "UNKNOWN" });

    const call = evidenceRepoMock.createLearningEvidence.mock.calls[0][1];
    expect(call).not.toHaveProperty("visibilityScope");
    expect(call.rightsClassification).toBe("USER_OWNED_OR_AUTHORIZED");
  });

  it("2. creates VOICE_TRANSCRIPT evidence with transcriptId carried into provenance, once reviewed content is explicitly submitted", async () => {
    await invokePost("client-1", { evidenceType: "VOICE_TRANSCRIPT", content: "Edited transcript text.", transcriptId: "transcript-9" });

    expect(evidenceRepoMock.createLearningEvidence).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        evidenceType: "VOICE_TRANSCRIPT",
        originalText: "Edited transcript text.",
        provenance: expect.objectContaining({ channel: "voice", transcriptId: "transcript-9" }),
      }),
      expect.anything(),
    );
  });

  it("passes a caller-supplied submissionId through for idempotency", async () => {
    await invokePost("client-1", { evidenceType: "TEXT", content: "x", submissionId: "sub-123" });

    expect(evidenceRepoMock.createLearningEvidence).toHaveBeenCalledWith("owner-1", expect.anything(), { submissionId: "sub-123" });
  });

  it("returns 400 with the validation message when the repository rejects the input", async () => {
    evidenceRepoMock.createLearningEvidence.mockRejectedValue(new evidenceRepoMock.ProfessionalLearningEvidenceValidationError("Invalid."));

    const response = await invokePost("client-1", { evidenceType: "TEXT", content: "x" });

    expect(response.status).toBe(400);
  });

  it("returns a fail-closed 503 (no-store) when persistence is unavailable", async () => {
    evidenceRepoMock.createLearningEvidence.mockRejectedValue(new Error("db down"));
    evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(true);

    const response = await invokePost("client-1", { evidenceType: "TEXT", content: "x" });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 201 with the created evidence on success", async () => {
    const response = await invokePost("client-1", { evidenceType: "TEXT", content: "x" });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.evidence.id).toBe("evidence-1");
  });
});
