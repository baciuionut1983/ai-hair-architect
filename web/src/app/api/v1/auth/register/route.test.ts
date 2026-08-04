import { beforeEach, describe, expect, it, vi } from "vitest";

const persistenceMocks = vi.hoisted(() => ({
  upsertPersistenceUser: vi.fn(),
  createPersistenceSession: vi.fn(),
}));
vi.mock("@/lib/auth-persistence", () => persistenceMocks);

const securityMocks = vi.hoisted(() => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/auth-security", () => securityMocks);

const storeMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));
vi.mock("@/lib/milestone1-store", () => storeMocks);

const emailMocks = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/lib/email-service", () => emailMocks);

import { POST } from "./route";

const USER = {
  id: "user-1",
  email: "new@example.com",
  passwordHash: "hashed",
  role: "professional" as const,
  locale: "en" as const,
  createdAt: "2026-08-04T00:00:00.000Z",
};

function invoke(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  storeMocks.findUserByEmail.mockReturnValue(null);
  storeMocks.createUser.mockReturnValue(USER);
  storeMocks.createSession.mockReturnValue("session-token");
  securityMocks.hashPassword.mockResolvedValue("hashed");
  persistenceMocks.upsertPersistenceUser.mockResolvedValue(undefined);
  persistenceMocks.createPersistenceSession.mockResolvedValue(undefined);
  emailMocks.sendTransactionalEmail.mockResolvedValue({ status: "sent", notificationId: "email-1", providerMessageId: "re_1" });
});

const VALID_BODY = { email: "new@example.com", password: "password123", role: "professional", locale: "en" };

describe("POST /api/v1/auth/register", () => {
  it("sends the welcome email with the exact onboarding fields on successful registration", async () => {
    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
    expect(emailMocks.sendTransactionalEmail).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      category: "onboarding",
      eventType: "user.registered",
      recipientEmail: "new@example.com",
      subject: "Welcome to AI Hair Architect",
      text: "Hi, your account has been created. You can now sign in and start using AI Hair Architect.",
      idempotencyKey: "onboarding.welcome:user-1",
      relatedEntityType: "User",
      relatedEntityId: "user-1",
    });
  });

  it("still returns 201 and a valid session when the email provider is disabled (skipped)", async () => {
    emailMocks.sendTransactionalEmail.mockResolvedValue({ status: "skipped", notificationId: "email-1" });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.token).toBe("session-token");
    expect(body.user.id).toBe("user-1");
  });

  it("still returns 201 when the email delivery fails", async () => {
    emailMocks.sendTransactionalEmail.mockResolvedValue({
      status: "failed",
      notificationId: "email-1",
      failureCode: "EMAIL_PROVIDER_ERROR",
    });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
  });

  it("still returns 201 even if sendTransactionalEmail unexpectedly rejects (defense in depth beyond its own never-throw contract)", async () => {
    emailMocks.sendTransactionalEmail.mockRejectedValue(new Error("should never happen, but must not break registration"));

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
  });

  it("never sends a welcome email for an invalid payload", async () => {
    const response = await invoke({ email: "not-an-email", password: "short", role: "professional" });

    expect(response.status).toBe(400);
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("never sends a welcome email when the email is already registered", async () => {
    storeMocks.findUserByEmail.mockReturnValue(USER);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(409);
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
