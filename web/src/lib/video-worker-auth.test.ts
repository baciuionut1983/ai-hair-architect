import { afterEach, describe, expect, it } from "vitest";

import { authenticateVideoWorkerRequest } from "./video-worker-auth";

const ORIGINAL_TOKEN = process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN;

function requestWithAuthHeader(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("http://localhost/api/v1/ops/video-demonstrations/recovery-run", { headers });
}

// Real AI Video Demonstration, Stage 3 (task §16) -- mirrors
// retention-automation-auth.test.ts's own exact coverage for the identical
// mechanism, applied to the Video worker trigger's own token.

describe("authenticateVideoWorkerRequest", () => {
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN;
    else process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = ORIGINAL_TOKEN;
  });

  it("fails closed as not_configured when the secret is unset, regardless of what header is presented -- a normal user can never say 'process all jobs'", () => {
    delete process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN;
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader("Bearer anything"))).toBe("not_configured");
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader(null))).toBe("not_configured");
  });

  it("fails closed as not_configured when the secret is set to an empty/whitespace string", () => {
    process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = "   ";
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader("Bearer anything"))).toBe("not_configured");
  });

  it("authorizes an exact matching bearer token", () => {
    process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = "correct-horse-battery-staple";
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader("Bearer correct-horse-battery-staple"))).toBe("authorized");
  });

  it("rejects a missing Authorization header", () => {
    process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = "secret-1";
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader(null))).toBe("unauthorized");
  });

  it("rejects a non-Bearer scheme", () => {
    process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = "secret-1";
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader("Basic secret-1"))).toBe("unauthorized");
  });

  it("rejects a wrong token", () => {
    process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = "secret-1";
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader("Bearer secret-2"))).toBe("unauthorized");
  });

  it("rejects a token that is a prefix or suffix of the real one (no partial match)", () => {
    process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = "secret-12345";
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader("Bearer secret-1234"))).toBe("unauthorized");
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader("Bearer secret-123456"))).toBe("unauthorized");
  });

  it("rejects an empty bearer token even when never explicitly configured to equal empty", () => {
    process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = "secret-1";
    expect(authenticateVideoWorkerRequest(requestWithAuthHeader("Bearer "))).toBe("unauthorized");
  });

  it("a session-authenticated user's own credentials (no Authorization header at all -- cookie-based) are never sufficient here", () => {
    process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN = "secret-1";
    const request = new Request("http://localhost/api/v1/ops/video-demonstrations/recovery-run", { headers: { cookie: "session=some-real-user-session-token" } });
    expect(authenticateVideoWorkerRequest(request)).toBe("unauthorized");
  });
});
