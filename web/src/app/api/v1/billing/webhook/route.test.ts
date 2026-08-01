import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hardeningMock = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  ensureRequestId: vi.fn(),
  getRequestClientIp: vi.fn(),
}));

vi.mock("@/lib/hardening", () => hardeningMock);

const processorMock = vi.hoisted(() => ({
  processBillingWebhookRequest: vi.fn(),
}));

vi.mock("@/lib/billing-webhook-processor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing-webhook-processor")>();
  return {
    ...actual,
    processBillingWebhookRequest: processorMock.processBillingWebhookRequest,
  };
});

import { POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  hardeningMock.checkRateLimit.mockReset().mockReturnValue({ allowed: true, remaining: 59 });
  hardeningMock.ensureRequestId.mockReset().mockReturnValue("req-fixed");
  hardeningMock.getRequestClientIp.mockReset().mockReturnValue("203.0.113.10");
  processorMock.processBillingWebhookRequest.mockReset();
});

afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
});

function buildRequest(options: {
  body?: string;
  signature?: string | null;
  headers?: Record<string, string>;
} = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
  if (options.signature !== null) {
    headers["stripe-signature"] = options.signature ?? "t=123,v1=abc";
  }
  return new Request("http://localhost/api/v1/billing/webhook", {
    method: "POST",
    headers,
    body: options.body ?? JSON.stringify({ id: "evt-1", type: "customer.subscription.updated" }),
  });
}

describe("billing webhook route", () => {
  it("blocks endpoint unconditionally in production without touching rate limiting or the processor", async () => {
    mutableEnv.NODE_ENV = "production";

    const response = await POST(buildRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "PRODUCTION_POLICY_BILLING_WEBHOOK_DISABLED",
    });
    expect(hardeningMock.checkRateLimit).not.toHaveBeenCalled();
    expect(processorMock.processBillingWebhookRequest).not.toHaveBeenCalled();
  });

  it("reads the raw body exactly once and forwards it with the Stripe-Signature header to the processor", async () => {
    mutableEnv.NODE_ENV = "test";
    processorMock.processBillingWebhookRequest.mockResolvedValue({
      httpStatus: 200,
      code: "BILLING_WEBHOOK_EVENT_PROCESSED",
    });
    const rawBody = JSON.stringify({ id: "evt-1", type: "customer.subscription.updated" });

    const response = await POST(buildRequest({ body: rawBody, signature: "t=999,v1=deadbeef" }));

    expect(processorMock.processBillingWebhookRequest).toHaveBeenCalledTimes(1);
    const call = processorMock.processBillingWebhookRequest.mock.calls[0][0];
    expect(call.rawBody).toBe(rawBody);
    expect(call.signatureHeader).toBe("t=999,v1=deadbeef");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      code: "BILLING_WEBHOOK_EVENT_PROCESSED",
      requestId: "req-fixed",
    });
  });

  it("passes null to the processor when the Stripe-Signature header is absent", async () => {
    mutableEnv.NODE_ENV = "test";
    processorMock.processBillingWebhookRequest.mockResolvedValue({
      httpStatus: 400,
      code: "BILLING_WEBHOOK_SIGNATURE_MISSING",
    });

    await POST(buildRequest({ signature: null }));

    expect(processorMock.processBillingWebhookRequest.mock.calls[0][0].signatureHeader).toBeNull();
  });

  it("keys the rate limiter using the client-IP helper, not a shared literal alone", async () => {
    mutableEnv.NODE_ENV = "test";
    hardeningMock.getRequestClientIp.mockReturnValue("198.51.100.42");
    processorMock.processBillingWebhookRequest.mockResolvedValue({
      httpStatus: 200,
      code: "BILLING_WEBHOOK_EVENT_PROCESSED",
    });

    await POST(buildRequest());

    expect(hardeningMock.getRequestClientIp).toHaveBeenCalledTimes(1);
    const [key] = hardeningMock.checkRateLimit.mock.calls[0];
    expect(key).toContain("198.51.100.42");
  });

  it("returns 429 and never calls the processor when the rate limit is exceeded", async () => {
    mutableEnv.NODE_ENV = "test";
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await POST(buildRequest());

    expect(response.status).toBe(429);
    expect(processorMock.processBillingWebhookRequest).not.toHaveBeenCalled();
  });

  it("returns a sanitized error body containing only the fixed code and message", async () => {
    mutableEnv.NODE_ENV = "test";
    processorMock.processBillingWebhookRequest.mockResolvedValue({
      httpStatus: 500,
      code: "BILLING_WEBHOOK_INTERNAL_ERROR",
    });

    const response = await POST(buildRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "BILLING_WEBHOOK_INTERNAL_ERROR",
      message: "Billing webhook processing failed.",
      requestId: "req-fixed",
    });
  });

  it("returns 503 with the disabled code when processing mode is disabled", async () => {
    mutableEnv.NODE_ENV = "test";
    processorMock.processBillingWebhookRequest.mockResolvedValue({
      httpStatus: 503,
      code: "BILLING_PROCESSING_DISABLED",
    });

    const response = await POST(buildRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "BILLING_PROCESSING_DISABLED",
      message: "Billing webhook processing is temporarily disabled.",
      requestId: "req-fixed",
    });
  });
});
