import { beforeEach, describe, expect, it, vi } from "vitest";

const tokenMocks = vi.hoisted(() => ({
  claimAuthToken: vi.fn(),
  findValidAuthToken: vi.fn(),
}));
vi.mock("@/lib/auth-token-repository", () => tokenMocks);

const prismaMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userUpdate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: prismaMocks.transaction,
  },
}));

import { POST } from "./route";

const tx = {
  user: { update: prismaMocks.userUpdate },
};

function invoke(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/v1/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const VALID_TOKEN_ROW = { id: "token-1", userId: "user-1", purpose: "email_verification" as const };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation(tx));
  tokenMocks.findValidAuthToken.mockResolvedValue(VALID_TOKEN_ROW);
  tokenMocks.claimAuthToken.mockResolvedValue(true);
  prismaMocks.userUpdate.mockResolvedValue(undefined);
});

describe("POST /api/v1/auth/verify-email", () => {
  it("returns 400 when the token is missing", async () => {
    const response = await invoke({});

    expect(response.status).toBe(400);
    expect(tokenMocks.findValidAuthToken).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid or expired token", async () => {
    tokenMocks.findValidAuthToken.mockResolvedValue(null);

    const response = await invoke({ token: "bad-token" });

    expect(response.status).toBe(400);
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it("claims the token and marks the user verified in one transaction", async () => {
    const response = await invoke({ token: "good-token" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verified).toBe(true);
    expect(tokenMocks.claimAuthToken).toHaveBeenCalledWith("token-1", "email_verification", expect.any(Date), tx);
    expect(prismaMocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerifiedAt: expect.any(Date) },
    });
  });

  it("returns 400 without verifying the user when the claim loses a race (already used)", async () => {
    tokenMocks.claimAuthToken.mockResolvedValue(false);

    const response = await invoke({ token: "good-token" });

    expect(response.status).toBe(400);
    expect(prismaMocks.userUpdate).not.toHaveBeenCalled();
  });

  it("returns 503 when the transaction fails for an unrelated reason", async () => {
    prismaMocks.transaction.mockRejectedValue(new Error("db down"));

    const response = await invoke({ token: "good-token" });

    expect(response.status).toBe(503);
  });
});
