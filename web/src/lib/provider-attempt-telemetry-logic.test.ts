import { describe, expect, it } from "vitest";

import { classifyProviderAttemptOutcome } from "./provider-attempt-telemetry-logic";

describe("classifyProviderAttemptOutcome", () => {
  it("classifies a succeeded attempt as success regardless of any other field", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: true, timedOut: false })).toBe("success");
    expect(classifyProviderAttemptOutcome({ succeeded: true, timedOut: true, httpStatus: 500 })).toBe("success");
  });

  it("classifies a timed-out attempt as timeout, even if an httpStatus happens to be present", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: true })).toBe("timeout");
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: true, httpStatus: 503 })).toBe("timeout");
  });

  it("classifies httpStatus 429 as http_429", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 429 })).toBe("http_429");
  });

  it("classifies any httpStatus >= 500 as http_5xx", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 500 })).toBe("http_5xx");
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 503 })).toBe("http_5xx");
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 599 })).toBe("http_5xx");
  });

  it("classifies a real, non-429/non-5xx HTTP status as http_error", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 401 })).toBe("http_error");
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 403 })).toBe("http_error");
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 400 })).toBe("http_error");
  });

  it("classifies an invalid/malformed response (no HTTP status known) as invalid_response", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, invalidResponse: true })).toBe("invalid_response");
  });

  it("classifies a genuine connection-level failure (no status, not a timeout, not flagged invalid) as network_error", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false })).toBe("network_error");
  });

  it("prefers a real httpStatus over invalidResponse when both are present -- a real HTTP error status is more specific than a generic parse failure", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 500, invalidResponse: true })).toBe("http_5xx");
  });

  it("classifies a 2xx status with an unusable body as invalid_response, never http_error -- a 2xx status is not an HTTP error", () => {
    expect(classifyProviderAttemptOutcome({ succeeded: false, timedOut: false, httpStatus: 200, invalidResponse: true })).toBe(
      "invalid_response",
    );
  });
});
