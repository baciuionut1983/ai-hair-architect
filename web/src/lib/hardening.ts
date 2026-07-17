import { randomUUID } from "crypto";

type Counter = { count: number; resetAt: number };

const rateLimitMap = new Map<string, Counter>();

export function ensureRequestId(input?: string | null): string {
  const normalized = String(input ?? "").trim();
  return normalized || randomUUID();
}

export function checkRateLimit(key: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
  const previous = rateLimitMap.get(key);

  if (!previous || previous.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs };
    rateLimitMap.set(key, next);
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (previous.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  previous.count += 1;
  rateLimitMap.set(key, previous);
  return { allowed: true, remaining: Math.max(0, maxRequests - previous.count) };
}

export function getRequestClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export function maskSensitive(input: string): string {
  if (input.length <= 4) {
    return "****";
  }

  return `${input.slice(0, 2)}***${input.slice(-2)}`;
}
