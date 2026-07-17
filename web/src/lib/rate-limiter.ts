const RATE_LIMITS = {
  UPLOAD: { requests: 10, windowMs: 60 * 1000 },
  ANALYZE: { requests: 20, windowMs: 60 * 1000 },
  REVIEW: { requests: 30, windowMs: 60 * 1000 },
  DOWNLOAD: { requests: 100, windowMs: 60 * 1000 },
};

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const limiters = new Map<string, Map<string, RateLimitEntry>>();

function getKey(userId: string, action: string): string {
  return `${userId}:${action}`;
}

export function checkRateLimit(userId: string, action: keyof typeof RATE_LIMITS): { allowed: boolean; retryAfter: number } {
  if (!userId) return { allowed: false, retryAfter: 0 };

  const limit = RATE_LIMITS[action];
  if (!limit) return { allowed: true, retryAfter: 0 };

  const key = getKey(userId, action);
  let userLimits = limiters.get(action);

  if (!userLimits) {
    userLimits = new Map();
    limiters.set(action, userLimits);
  }

  let entry = userLimits.get(key);
  const now = Date.now();

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + limit.windowMs };
    userLimits.set(key, entry);
  }

  if (entry.count >= limit.requests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

export function getRateLimitStatus(userId: string, action: keyof typeof RATE_LIMITS) {
  const limit = RATE_LIMITS[action];
  if (!limit) return null;

  const key = getKey(userId, action);
  const userLimits = limiters.get(action);
  const entry = userLimits?.get(key);
  const now = Date.now();

  if (!entry || now >= entry.resetAt) {
    return {
      limit: limit.requests,
      remaining: limit.requests,
      reset: now + limit.windowMs,
    };
  }

  return {
    limit: limit.requests,
    remaining: Math.max(0, limit.requests - entry.count),
    reset: entry.resetAt,
  };
}

export function cleanupExpiredLimiters() {
  const now = Date.now();
  limiters.forEach((userLimits, action) => {
    userLimits.forEach((entry, key) => {
      if (now >= entry.resetAt) {
        userLimits.delete(key);
      }
    });
    if (userLimits.size === 0) {
      limiters.delete(action);
    }
  });
}

setInterval(cleanupExpiredLimiters, 5 * 60 * 1000);
