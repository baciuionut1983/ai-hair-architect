import { describe, expect, it } from "vitest";

import { hashPassword, isBcryptHash, verifyPassword } from "./auth-security";

describe("auth-security", () => {
  it("hashes and verifies passwords", async () => {
    const password = "StrongPass!123";
    const passwordHash = await hashPassword(password);

    expect(isBcryptHash(passwordHash)).toBe(true);
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-pass", passwordHash)).resolves.toBe(false);
  });

  it("rejects non-bcrypt legacy strings", async () => {
    await expect(verifyPassword("password123", "password123")).resolves.toBe(false);
  });
});
