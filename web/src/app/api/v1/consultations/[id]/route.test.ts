import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const consultationRepositoryMock = vi.hoisted(() => ({
  findConsultationForOwner: vi.fn(),
  isConsultationPersistenceError: vi.fn(),
  consultationPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("@/lib/consultation-repository", () => consultationRepositoryMock);
vi.mock("@/lib/session-request-auth", () => authMock);

import { GET } from "./route";

const OWNER_A = {
  id: "user-1",
  email: "user1@example.com",
  role: "professional",
  locale: "en",
};

function invoke(id = "consultation-1"): Promise<Response> {
  return GET({} as never, { params: Promise.resolve({ id }) });
}

describe("consultation by id route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    consultationRepositoryMock.isConsultationPersistenceError.mockReturnValue(false);
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
    expect(consultationRepositoryMock.findConsultationForOwner).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
  });

  it("returns 404 when consultation is missing or not owned", async () => {
    consultationRepositoryMock.findConsultationForOwner.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Consultation not found." });
    expect(consultationRepositoryMock.findConsultationForOwner).toHaveBeenCalledWith("user-1", "consultation-1");
  });

  it("returns consultation for the owning user", async () => {
    consultationRepositoryMock.findConsultationForOwner.mockResolvedValue({
      id: "consultation-1",
      clientId: "client-1",
      analysisId: "analysis-1",
      summary: "Summary",
      nextSteps: ["Step 1"],
      createdAt: new Date().toISOString(),
    });

    const response = await invoke();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      consultation: {
        id: "consultation-1",
        clientId: "client-1",
      },
    });
  });

  it("scopes the lookup strictly to the authenticated owner (cross-user isolation)", async () => {
    consultationRepositoryMock.findConsultationForOwner.mockResolvedValue(null);
    authMock.authenticateSessionRequest.mockResolvedValue({ ...OWNER_A, id: "user-2" });

    await invoke();

    expect(consultationRepositoryMock.findConsultationForOwner).toHaveBeenCalledWith("user-2", "consultation-1");
    expect(consultationRepositoryMock.findConsultationForOwner).not.toHaveBeenCalledWith("user-1", "consultation-1");
  });

  it("fails closed with 503 when consultation persistence is unavailable", async () => {
    const error = new Error("db down");
    consultationRepositoryMock.findConsultationForOwner.mockRejectedValue(error);
    consultationRepositoryMock.isConsultationPersistenceError.mockImplementation((value: unknown) => value === error);
    consultationRepositoryMock.consultationPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "CONSULTATION_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
    );

    const response = await invoke();

    expect(response.status).toBe(503);
  });
});
