import { beforeEach, describe, expect, it, vi } from "vitest";

const persistenceMocks = vi.hoisted(() => ({
  findPersistenceUserByEmail: vi.fn(),
}));
vi.mock("@/lib/auth-persistence", () => persistenceMocks);

const tokenMocks = vi.hoisted(() => ({ issueAuthToken: vi.fn() }));
vi.mock("@/lib/auth-token-repository", () => tokenMocks);

const emailMocks = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/lib/email-service", () => emailMocks);

const hardeningMocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getRequestClientIp: vi.fn(),
}));
vi.mock("@/lib/hardening", () => hardeningMocks);

const storeMocks = vi.hoisted(() => ({
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));
vi.mock("@/lib/milestone1-store", () => storeMocks);

import { POST } from "./route";

const USER = {
  id: "user-1",
  email: "user@example.com",
  passwordHash: "hashed",
  role: "professional" as const,
  locale: "en" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  emailVerifiedAt: "2026-08-02T00:00:00.000Z",
};

const ISSUED_TOKEN = { rawToken: "raw-token", tokenId: "token-1", expiresAt: new Date("2026-08-05T01:00:00.000Z") };

function invoke(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/v1/auth/request-password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const GENERIC_MESSAGE = "If an account with that email exists, a password reset link has been sent.";

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  hardeningMocks.checkRateLimit.mockReturnValue({ allowed: true, remaining: 4 });
  hardeningMocks.getRequestClientIp.mockReturnValue("127.0.0.1");
  persistenceMocks.findPersistenceUserByEmail.mockResolvedValue(USER);
  tokenMocks.issueAuthToken.mockResolvedValue(ISSUED_TOKEN);
  emailMocks.sendTransactionalEmail.mockResolvedValue({ status: "sent", notificationId: "email-1", providerMessageId: "re_1" });
});

describe("POST /api/v1/auth/request-password-reset", () => {
  it("returns the generic ack and issues a 1-hour password_reset token for an existing account", async () => {
    const response = await invoke({ email: "user@example.com" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe(GENERIC_MESSAGE);
    expect(tokenMocks.issueAuthToken).toHaveBeenCalledWith("user-1", "password_reset", 60 * 60 * 1000);
    expect(emailMocks.sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        category: "security",
        eventType: "user.password_reset_requested",
        recipientEmail: "user@example.com",
        idempotencyKey: "security.password_reset:token-1",
      }),
    );
    const call = emailMocks.sendTransactionalEmail.mock.calls[0][0];
    expect(call.text).toContain("http://localhost:3000/reset-password?token=raw-token");
  });

  it("returns the identical generic ack when no account exists for the email", async () => {
    persistenceMocks.findPersistenceUserByEmail.mockResolvedValue(null);

    const response = await invoke({ email: "nobody@example.com" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe(GENERIC_MESSAGE);
    expect(tokenMocks.issueAuthToken).not.toHaveBeenCalled();
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns the identical generic ack for a malformed email without ever looking it up", async () => {
    const response = await invoke({ email: "not-an-email" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe(GENERIC_MESSAGE);
    expect(persistenceMocks.findPersistenceUserByEmail).not.toHaveBeenCalled();
  });

  it("never changes the response when token issuance fails", async () => {
    tokenMocks.issueAuthToken.mockRejectedValue(new Error("db down"));

    const response = await invoke({ email: "user@example.com" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe(GENERIC_MESSAGE);
  });

  it("never changes the response when the email send fails", async () => {
    emailMocks.sendTransactionalEmail.mockRejectedValue(new Error("provider down"));

    const response = await invoke({ email: "user@example.com" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe(GENERIC_MESSAGE);
  });

  it("returns 429 when the rate limit is exceeded, distinct from the generic ack", async () => {
    hardeningMocks.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invoke({ email: "user@example.com" });

    expect(response.status).toBe(429);
    expect(persistenceMocks.findPersistenceUserByEmail).not.toHaveBeenCalled();
  });
});
