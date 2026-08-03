import { beforeEach, describe, expect, it, vi } from "vitest";

const { PRISMA_MOCK } = vi.hoisted(() => ({
  PRISMA_MOCK: {
    session: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: PRISMA_MOCK }));

import { authenticateBillingSessionOwner } from "./billing-session-auth";

function request(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("Authorization", header);
  return { headers } as unknown as Request;
}

function sessionRow(overrides: Partial<{ expiresAt: Date; user: unknown }> = {}) {
  return {
    token: "token-1",
    userId: "owner-1",
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    user: "user" in overrides ? overrides.user : {
      id: "owner-1",
      email: "owner@example.com",
      role: "professional",
      locale: "en",
    },
  };
}

describe("authenticateBillingSessionOwner", () => {
  beforeEach(() => {
    PRISMA_MOCK.session.findUnique.mockReset();
  });

  it("returns null when the Authorization header is absent", async () => {
    await expect(authenticateBillingSessionOwner(request(null))).resolves.toBeNull();
    expect(PRISMA_MOCK.session.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the header does not use the Bearer scheme", async () => {
    await expect(authenticateBillingSessionOwner(request("Basic abc123"))).resolves.toBeNull();
    expect(PRISMA_MOCK.session.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the Bearer token is empty", async () => {
    await expect(authenticateBillingSessionOwner(request("Bearer    "))).resolves.toBeNull();
    expect(PRISMA_MOCK.session.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when no session matches the token", async () => {
    PRISMA_MOCK.session.findUnique.mockResolvedValueOnce(null);
    await expect(authenticateBillingSessionOwner(request("Bearer token-1"))).resolves.toBeNull();
  });

  it("returns null when the session is expired", async () => {
    PRISMA_MOCK.session.findUnique.mockResolvedValueOnce(sessionRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(authenticateBillingSessionOwner(request("Bearer token-1"))).resolves.toBeNull();
  });

  it("returns null when expiresAt equals the current instant (not strictly in the future)", async () => {
    const now = new Date();
    vi.setSystemTime(now);
    PRISMA_MOCK.session.findUnique.mockResolvedValueOnce(sessionRow({ expiresAt: now }));
    await expect(authenticateBillingSessionOwner(request("Bearer token-1"))).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("returns null when the session has no associated user", async () => {
    PRISMA_MOCK.session.findUnique.mockResolvedValueOnce(sessionRow({ user: null }));
    await expect(authenticateBillingSessionOwner(request("Bearer token-1"))).resolves.toBeNull();
  });

  it("returns null and does not throw when the lookup fails unexpectedly", async () => {
    PRISMA_MOCK.session.findUnique.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(authenticateBillingSessionOwner(request("Bearer token-1"))).resolves.toBeNull();
  });

  it("resolves the owner for a valid, unexpired session", async () => {
    PRISMA_MOCK.session.findUnique.mockResolvedValueOnce(sessionRow());
    await expect(authenticateBillingSessionOwner(request("Bearer token-1"))).resolves.toEqual({
      id: "owner-1",
      email: "owner@example.com",
      role: "professional",
      locale: "en",
    });
    expect(PRISMA_MOCK.session.findUnique).toHaveBeenCalledWith({
      where: { token: "token-1" },
      include: { user: true },
    });
  });

  it("normalizes any non-ro locale to en", async () => {
    PRISMA_MOCK.session.findUnique.mockResolvedValueOnce(
      sessionRow({ user: { id: "owner-1", email: "owner@example.com", role: "salon", locale: "fr" } }),
    );
    const result = await authenticateBillingSessionOwner(request("Bearer token-1"));
    expect(result?.locale).toBe("en");
  });
});
