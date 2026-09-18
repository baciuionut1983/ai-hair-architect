import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));

const serviceMock = vi.hoisted(() => {
  class ProfessionalLearningProceduralReviewServiceError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { submitProceduralClaimReview: vi.fn(), ProfessionalLearningProceduralReviewServiceError };
});

const draftRepoMock = vi.hoisted(() => {
  class ProfessionalLearningProceduralReviewStateError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly httpStatus = 409,
    ) {
      super(message);
    }
  }
  return {
    isProfessionalLearningDraftPersistenceError: vi.fn(() => false),
    professionalLearningDraftPersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "UNAVAILABLE" }, { status: 503 })),
    ProfessionalLearningProceduralReviewStateError,
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/professional-learning-procedural-review-service", () => serviceMock);
vi.mock("@/lib/professional-learning-draft-repository", () => draftRepoMock);

import { POST } from "./route";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.4.b.1 --
// route-level tests, real request/Response objects, the service/auth
// layers hand-mocked (this codebase's own no-mocking-library
// convention). The property under test here is specifically what the
// T1.4.b audit's own "AUTHENTICATION" section demanded: reviewer
// identity is NEVER read from the request body, only from the
// authenticated session -- proven directly against the real POST
// handler, not merely asserted in prose.

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invokePost(draftId: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/learning-drafts/${draftId}/procedural-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ draftId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
});

describe("POST /api/v1/learning-drafts/[draftId]/procedural-review", () => {
  it("returns 401 without an authenticated session, and never calls the service", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await invokePost("draft-1", { claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED" });
    expect(response.status).toBe(401);
    expect(serviceMock.submitProceduralClaimReview).not.toHaveBeenCalled();
  });

  it("returns 400 when claimId is missing", async () => {
    const response = await invokePost("draft-1", { decision: "PROFESSIONALLY_CONFIRMED" });
    expect(response.status).toBe(400);
    expect(serviceMock.submitProceduralClaimReview).not.toHaveBeenCalled();
  });

  it("returns 400 when decision is missing", async () => {
    const response = await invokePost("draft-1", { claimId: "COMBING" });
    expect(response.status).toBe(400);
    expect(serviceMock.submitProceduralClaimReview).not.toHaveBeenCalled();
  });

  it("derives reviewedByUserId EXCLUSIVELY from the authenticated session -- a client-supplied reviewedByUserId in the body is never forwarded", async () => {
    serviceMock.submitProceduralClaimReview.mockResolvedValue({ id: "draft-1", proceduralReview: null });

    await invokePost("draft-1", {
      claimId: "COMBING",
      decision: "PROFESSIONALLY_CONFIRMED",
      // A malicious/confused client attempting to claim someone else
      // approved this -- must be completely ignored.
      reviewedByUserId: "someone-else",
      reviewerUserId: "someone-else",
      ownerUserId: "someone-else",
    });

    expect(serviceMock.submitProceduralClaimReview).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: OWNER.id, reviewedByUserId: OWNER.id, draftId: "draft-1", claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED" }),
    );
    // Never the spoofed value, under any field name.
    const callArgs = serviceMock.submitProceduralClaimReview.mock.calls[0][0];
    expect(callArgs.reviewedByUserId).not.toBe("someone-else");
    expect(callArgs.ownerUserId).not.toBe("someone-else");
  });

  it("passes optional correctedValue/note straight through when they are strings", async () => {
    serviceMock.submitProceduralClaimReview.mockResolvedValue({ id: "draft-1", proceduralReview: null });

    await invokePost("draft-1", { claimId: "CUTTING_ACTION", decision: "PROFESSIONALLY_CORRECTED", correctedValue: "45 Interior", note: "confirmed by Ionuț" });

    expect(serviceMock.submitProceduralClaimReview).toHaveBeenCalledWith(expect.objectContaining({ correctedValue: "45 Interior", note: "confirmed by Ionuț" }));
  });

  it("ignores a non-string correctedValue/note rather than forwarding a malformed type", async () => {
    serviceMock.submitProceduralClaimReview.mockResolvedValue({ id: "draft-1", proceduralReview: null });

    await invokePost("draft-1", { claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", correctedValue: 12345, note: { nested: true } });

    const callArgs = serviceMock.submitProceduralClaimReview.mock.calls[0][0];
    expect(callArgs.correctedValue).toBeUndefined();
    expect(callArgs.note).toBeUndefined();
  });

  it("returns 200 with the draft on success", async () => {
    const draft = { id: "draft-1", proceduralReview: { claims: { COMBING: { decision: "PROFESSIONALLY_CONFIRMED" } } } };
    serviceMock.submitProceduralClaimReview.mockResolvedValue(draft);

    const response = await invokePost("draft-1", { claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ draft });
  });

  it("maps a service error to its own declared httpStatus/code", async () => {
    serviceMock.submitProceduralClaimReview.mockRejectedValue(new serviceMock.ProfessionalLearningProceduralReviewServiceError("PROCEDURAL_CLAIM_NOT_FOUND", 404, "not found"));

    const response = await invokePost("draft-1", { claimId: "FABRICATED", decision: "PROFESSIONALLY_CONFIRMED" });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("PROCEDURAL_CLAIM_NOT_FOUND");
  });

  it("maps a repository state error (e.g. concurrent modification) to its own declared httpStatus/code", async () => {
    serviceMock.submitProceduralClaimReview.mockRejectedValue(new draftRepoMock.ProfessionalLearningProceduralReviewStateError("CONCURRENT_MODIFICATION", "conflict", 409));

    const response = await invokePost("draft-1", { claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED" });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("CONCURRENT_MODIFICATION");
  });

  it("returns 503 when draft persistence is unavailable", async () => {
    draftRepoMock.isProfessionalLearningDraftPersistenceError.mockReturnValue(true);
    serviceMock.submitProceduralClaimReview.mockRejectedValue(new Error("db down"));

    const response = await invokePost("draft-1", { claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED" });
    expect(response.status).toBe(503);
  });
});
