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

const UNVERIFIED_USER = {
  id: "user-1",
  email: "user@example.com",
  passwordHash: "hashed",
  role: "professional" as const,
  locale: "en" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  emailVerifiedAt: null,
};

const VERIFIED_USER = { ...UNVERIFIED_USER, emailVerifiedAt: "2026-08-02T00:00:00.000Z" };

const ISSUED_TOKEN = { rawToken: "raw-token", tokenId: "token-1", expiresAt: new Date("2026-08-06T00:00:00.000Z") };

function invoke(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/v1/auth/resend-verification-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const GENERIC_MESSAGE = "If an account with that email exists and is not yet verified, a verification link has been sent.";

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  hardeningMocks.checkRateLimit.mockReturnValue({ allowed: true, remaining: 4 });
  hardeningMocks.getRequestClientIp.mockReturnValue("127.0.0.1");
  persistenceMocks.findPersistenceUserByEmail.mockResolvedValue(UNVERIFIED_USER);
  tokenMocks.issueAuthToken.mockResolvedValue(ISSUED_TOKEN);
  emailMocks.sendTransactionalEmail.mockResolvedValue({ status: "sent", notificationId: "email-1", providerMessageId: "re_1" });
});

describe("POST /api/v1/auth/resend-verification-email", () => {
  it("returns the generic ack and issues a fresh token + email for an existing unverified account", async () => {
    const response = await invoke({ email: "user@example.com" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe(GENERIC_MESSAGE);
    expect(tokenMocks.issueAuthToken).toHaveBeenCalledWith("user-1", "email_verification", 24 * 60 * 60 * 1000);
    expect(emailMocks.sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        category: "security",
        eventType: "user.email_verification_requested",
        recipientEmail: "user@example.com",
        idempotencyKey: "security.email_verification:token-1",
      }),
    );
  });

  it("includes an HTML version of the verification email with the correct link", async () => {
    await invoke({ email: "user@example.com" });

    const call = emailMocks.sendTransactionalEmail.mock.calls[0][0];
    expect(typeof call.html).toBe("string");
    expect(call.html).toContain("/verify-email?token=raw-token");
    expect(call.html).toContain("AI Hair Architect");
  });

  it("returns the identical generic ack for an already-verified account, without issuing a token", async () => {
    persistenceMocks.findPersistenceUserByEmail.mockResolvedValue(VERIFIED_USER);

    const response = await invoke({ email: "user@example.com" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe(GENERIC_MESSAGE);
    expect(tokenMocks.issueAuthToken).not.toHaveBeenCalled();
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
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
