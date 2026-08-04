import { beforeEach, describe, expect, it, vi } from "vitest";

const persistenceMocks = vi.hoisted(() => ({
  upsertPersistenceUser: vi.fn(),
}));
vi.mock("@/lib/auth-persistence", () => persistenceMocks);

const securityMocks = vi.hoisted(() => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/auth-security", () => securityMocks);

const tokenMocks = vi.hoisted(() => ({ issueAuthToken: vi.fn() }));
vi.mock("@/lib/auth-token-repository", () => tokenMocks);

const storeMocks = vi.hoisted(() => ({
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

const ISSUED_TOKEN = {
  rawToken: "raw-token-value",
  tokenId: "token-1",
  expiresAt: new Date("2026-08-05T00:00:00.000Z"),
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
  securityMocks.hashPassword.mockResolvedValue("hashed");
  persistenceMocks.upsertPersistenceUser.mockResolvedValue(undefined);
  tokenMocks.issueAuthToken.mockResolvedValue(ISSUED_TOKEN);
  emailMocks.sendTransactionalEmail.mockResolvedValue({ status: "sent", notificationId: "email-1", providerMessageId: "re_1" });
});

const VALID_BODY = { email: "new@example.com", password: "password123", role: "professional", locale: "en" };

describe("POST /api/v1/auth/register", () => {
  it("creates the account without a session and requires email verification", async () => {
    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      message: "Account created. Please check your email to verify your address before signing in.",
      email: "new@example.com",
      emailVerificationRequired: true,
    });
    expect(body.token).toBeUndefined();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("issues an email_verification token and sends the verification email instead of a welcome email", async () => {
    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
    expect(tokenMocks.issueAuthToken).toHaveBeenCalledWith("user-1", "email_verification", 24 * 60 * 60 * 1000);
    expect(emailMocks.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(emailMocks.sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        category: "security",
        eventType: "user.email_verification_requested",
        recipientEmail: "new@example.com",
        idempotencyKey: "security.email_verification:token-1",
        relatedEntityType: "AuthToken",
        relatedEntityId: "token-1",
      }),
    );
    const call = emailMocks.sendTransactionalEmail.mock.calls[0][0];
    expect(call.text).toContain("http://localhost:3000/verify-email?token=raw-token-value");
  });

  it("still returns 201 when the email provider is disabled (skipped)", async () => {
    emailMocks.sendTransactionalEmail.mockResolvedValue({ status: "skipped", notificationId: "email-1" });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
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

  it("still returns 201 even if issueAuthToken unexpectedly rejects -- registration must never be blocked by the verification email", async () => {
    tokenMocks.issueAuthToken.mockRejectedValue(new Error("should never happen, but must not break registration"));

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
  });

  it("still returns 201 even if sendTransactionalEmail unexpectedly rejects", async () => {
    emailMocks.sendTransactionalEmail.mockRejectedValue(new Error("should never happen, but must not break registration"));

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
  });

  it("never issues a verification token for an invalid payload", async () => {
    const response = await invoke({ email: "not-an-email", password: "short", role: "professional" });

    expect(response.status).toBe(400);
    expect(tokenMocks.issueAuthToken).not.toHaveBeenCalled();
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("never issues a verification token when the email is already registered", async () => {
    storeMocks.findUserByEmail.mockReturnValue(USER);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(409);
    expect(tokenMocks.issueAuthToken).not.toHaveBeenCalled();
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
