import { compare, hash } from "bcryptjs";

const DEFAULT_COST = 12;

export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$.{53}$/.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  const roundsRaw = Number(process.env.AUTH_BCRYPT_COST ?? DEFAULT_COST);
  const rounds = Number.isFinite(roundsRaw) ? Math.min(14, Math.max(10, roundsRaw)) : DEFAULT_COST;
  return hash(password, rounds);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (!isBcryptHash(passwordHash)) {
    return false;
  }

  return compare(password, passwordHash);
}
