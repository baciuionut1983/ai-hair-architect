import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/milestone1-store", () => ({
  getSession: vi.fn(),
  getConsultationByIdForUser: vi.fn(),
}));

import { GET } from "./route";
import { getConsultationByIdForUser, getSession } from "@/lib/milestone1-store";

describe("consultation by id route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when caller is not authenticated", async () => {
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(getSession).mockReturnValue(null);

    const response = await GET({} as never, { params: Promise.resolve({ id: "consultation-1" }) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  it("returns 404 when consultation is missing or not owned", async () => {
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(getSession).mockReturnValue({
      id: "user-1",
      email: "user1@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    });
    vi.mocked(getConsultationByIdForUser).mockReturnValue(null);

    const response = await GET({} as never, { params: Promise.resolve({ id: "consultation-1" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Consultation not found." });
    expect(vi.mocked(getConsultationByIdForUser)).toHaveBeenCalledWith("consultation-1", "user-1");
  });

  it("returns consultation for owning user", async () => {
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(getSession).mockReturnValue({
      id: "user-1",
      email: "user1@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    });
    vi.mocked(getConsultationByIdForUser).mockReturnValue({
      id: "consultation-1",
      clientId: "client-1",
      analysisId: "analysis-1",
      summary: "Summary",
      nextSteps: ["Step 1"],
      createdAt: new Date().toISOString(),
    });

    const response = await GET({} as never, { params: Promise.resolve({ id: "consultation-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      consultation: {
        id: "consultation-1",
        clientId: "client-1",
      },
    });
  });
});