import { beforeEach, describe, expect, it, vi } from "vitest";

const hardeningMocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getRequestClientIp: vi.fn(),
}));
vi.mock("@/lib/hardening", () => hardeningMocks);

const persistenceMocks = vi.hoisted(() => ({
  createPersistenceUserExclusive: vi.fn(),
  findPersistenceUserByEmail: vi.fn(),
}));
vi.mock("@/lib/auth-persistence", () => persistenceMocks);

const securityMocks = vi.hoisted(() => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/auth-security", () => securityMocks);

const tokenMocks = vi.hoisted(() => ({ issueAuthToken: vi.fn() }));
vi.mock("@/lib/auth-token-repository", () => tokenMocks);

const storeMocks = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  upsertUser: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));
vi.mock("@/lib/milestone1-store", () => storeMocks);

const emailMocks = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/lib/email-service", () => emailMocks);

import { POST } from "./route";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  hardeningMocks.checkRateLimit.mockReturnValue({ allowed: true, remaining: 7 });
  hardeningMocks.getRequestClientIp.mockReturnValue("127.0.0.1");
  storeMocks.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  storeMocks.findUserByEmail.mockReturnValue(null);
  storeMocks.upsertUser.mockReturnValue(USER);
  securityMocks.hashPassword.mockResolvedValue("hashed");
  persistenceMocks.findPersistenceUserByEmail.mockResolvedValue(null);
  persistenceMocks.createPersistenceUserExclusive.mockResolvedValue({ status: "created", id: "user-1" });
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

  it("passes a freshly generated UUID candidate id and the validated fields to createPersistenceUserExclusive", async () => {
    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
    expect(persistenceMocks.createPersistenceUserExclusive).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(UUID_PATTERN),
        email: "new@example.com",
        passwordHash: "hashed",
        role: "professional",
        locale: "en",
      }),
    );
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

  it("includes an HTML version of the verification email with the correct link", async () => {
    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
    const call = emailMocks.sendTransactionalEmail.mock.calls[0][0];
    expect(typeof call.html).toBe("string");
    expect(call.html).toContain("http://localhost:3000/verify-email?token=raw-token-value");
    expect(call.html).toContain("AI Hair Architect");
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

  it("never issues a verification token when the email is already registered in memory", async () => {
    storeMocks.findUserByEmail.mockReturnValue(USER);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(409);
    expect(persistenceMocks.createPersistenceUserExclusive).not.toHaveBeenCalled();
    expect(tokenMocks.issueAuthToken).not.toHaveBeenCalled();
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns 429 without touching persistence when the rate limiter rejects the request", async () => {
    hardeningMocks.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(429);
    expect(persistenceMocks.createPersistenceUserExclusive).not.toHaveBeenCalled();
  });

  it("returns 409 without writing anything when the email exists in Postgres but the in-memory store is cold (post-restart case)", async () => {
    // Simulates the exact production scenario: a Railway restart wiped the
    // process-local in-memory store, but the account genuinely already
    // exists in Postgres.
    storeMocks.findUserByEmail.mockReturnValue(null);
    persistenceMocks.findPersistenceUserByEmail.mockResolvedValue({
      id: "existing-user",
      email: "new@example.com",
      passwordHash: "original-hash",
      role: "professional",
      locale: "en",
      createdAt: "2026-01-01T00:00:00.000Z",
      emailVerifiedAt: "2026-01-02T00:00:00.000Z",
    });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(409);
    expect(persistenceMocks.createPersistenceUserExclusive).not.toHaveBeenCalled();
    expect(storeMocks.upsertUser).not.toHaveBeenCalled();
    expect(tokenMocks.issueAuthToken).not.toHaveBeenCalled();
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns 409 and never issues a token when Postgres reports a create-time conflict (concurrent registration race)", async () => {
    persistenceMocks.createPersistenceUserExclusive.mockResolvedValue({ status: "conflict" });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(409);
    expect(storeMocks.upsertUser).not.toHaveBeenCalled();
    expect(tokenMocks.issueAuthToken).not.toHaveBeenCalled();
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns 503, not 201, when persistence genuinely fails -- never masks a real database error as success", async () => {
    persistenceMocks.createPersistenceUserExclusive.mockRejectedValue(new Error("connection reset"));

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Account data is temporarily unavailable.");
    expect(storeMocks.upsertUser).not.toHaveBeenCalled();
    expect(tokenMocks.issueAuthToken).not.toHaveBeenCalled();
  });

  it("issues the AuthToken using the id Postgres actually confirmed, never an id only generated in memory", async () => {
    // The confirmed id deliberately differs from anything the route could
    // have fabricated locally, proving issueAuthToken/sendTransactionalEmail
    // are wired to the database-confirmed id, not a locally-generated one --
    // this is the exact defect that produced AuthToken_userId_fkey in
    // production.
    persistenceMocks.createPersistenceUserExclusive.mockResolvedValue({ status: "created", id: "confirmed-db-id" });
    storeMocks.upsertUser.mockReturnValue({ ...USER, id: "confirmed-db-id" });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
    expect(storeMocks.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: "confirmed-db-id", email: "new@example.com" }),
    );
    expect(tokenMocks.issueAuthToken).toHaveBeenCalledWith("confirmed-db-id", "email_verification", 24 * 60 * 60 * 1000);
    expect(emailMocks.sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "confirmed-db-id" }),
    );
  });

  it("still syncs the in-memory store with a valid generated id when persistence is intentionally skipped (DB-less dev mode)", async () => {
    persistenceMocks.createPersistenceUserExclusive.mockResolvedValue({ status: "skipped" });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(201);
    expect(storeMocks.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringMatching(UUID_PATTERN), email: "new@example.com" }),
    );
  });
});
