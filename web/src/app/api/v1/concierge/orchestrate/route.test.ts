import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const { RESOLVE_DECISION_MOCK } = vi.hoisted(() => ({ RESOLVE_DECISION_MOCK: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/orchestrator-service", () => ({ resolveOrchestratorDecision: RESOLVE_DECISION_MOCK }));

import { POST } from "./route";

const OWNER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", role: "professional", locale: "en" };

const FAKE_DECISION = {
  intent: "open_clients",
  targetVertical: "clients",
  targetClientId: null,
  targetAnalysisId: null,
  currentContext: { roleClass: "professional", currentClientId: null, currentAnalysisId: null, hasCompletedPhotoPreview: false },
  recommendedAction: "OPEN_CLIENTS",
  availableActions: ["OPEN_CLIENTS"],
  requiresProfessionalApproval: false,
  requiresUserConsent: false,
  costClass: "NO_INCREMENTAL_COST",
  reasonCode: "no_client_selected",
  nextStepCode: "no_client_selected",
};

function request(body: unknown) {
  return new Request("http://localhost/api/v1/concierge/orchestrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// AI Concierge / Orchestrator, Stage 1 -- HTTP boundary tests. The real
// ownership/authority checks are exercised for real (real Postgres) in
// orchestrator-service.test.ts; this file proves the ROUTE's own
// responsibilities: session auth, input validation, and that it passes
// the authenticated user's own id/role through -- never anything the
// client could substitute.
describe("POST /api/v1/concierge/orchestrate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
    RESOLVE_DECISION_MOCK.mockResolvedValue(FAKE_DECISION);
  });

  it("returns 401 when unauthenticated, never reaching the orchestrator", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await POST(request({ message: "hello" }));
    expect(response.status).toBe(401);
    expect(RESOLVE_DECISION_MOCK).not.toHaveBeenCalled();
  });

  it("returns 422 for a missing/empty message", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(422);
    expect(RESOLVE_DECISION_MOCK).not.toHaveBeenCalled();
  });

  it("returns 422 for a message exceeding the max length", async () => {
    const response = await POST(request({ message: "x".repeat(2001) }));
    expect(response.status).toBe(422);
  });

  it("returns 400 for an invalid JSON body", async () => {
    const response = await POST(new Request("http://localhost/api", { method: "POST", body: "not json" }));
    expect(response.status).toBe(400);
  });

  it("passes the AUTHENTICATED user's own id/role -- never anything the client body could supply", async () => {
    await POST(request({ message: "show me the result", ownerUserId: "someone-elses-id", roleClass: "public" }));

    expect(RESOLVE_DECISION_MOCK).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: OWNER.id, roleClass: "professional" }),
    );
  });

  it("forwards currentClientId/currentAnalysisId/hasCompletedPhotoPreview from the body -- ownership is verified downstream, never here", async () => {
    await POST(request({ message: "show me the result", currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true }));

    expect(RESOLVE_DECISION_MOCK).toHaveBeenCalledWith(
      expect.objectContaining({ currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true }),
    );
  });

  it("returns the decision wrapped in { decision }, unmodified", async () => {
    const response = await POST(request({ message: "show me the result" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ decision: FAKE_DECISION });
  });

  it("never exposes Cache-Control caching for a personalized decision", async () => {
    const response = await POST(request({ message: "show me the result" }));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
