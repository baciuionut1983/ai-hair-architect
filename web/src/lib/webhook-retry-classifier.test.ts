import { describe, expect, it } from "vitest";

import { classifyWebhookRetry } from "@/lib/webhook-retry-classifier";

describe("webhook retry classifier", () => {
  it("treats 2xx as success", () => {
    expect(classifyWebhookRetry({ httpStatus: 204 })).toMatchObject({
      deliveryStatus: "delivered",
      outcome: "success",
      failureCode: "none",
    });
  });

  it("treats 3xx as terminal redirect-blocked", () => {
    expect(classifyWebhookRetry({ httpStatus: 302 })).toMatchObject({
      deliveryStatus: "failed_terminal",
      failureCode: "http_3xx_redirect_blocked",
    });
  });

  it("treats temporary DNS as retryable", () => {
    expect(classifyWebhookRetry({ systemErrorCode: "EAI_AGAIN" })).toMatchObject({
      deliveryStatus: "failed_retryable",
      failureCode: "dns_temporary",
    });
  });

  it("treats ENOTFOUND as terminal", () => {
    expect(classifyWebhookRetry({ systemErrorCode: "ENOTFOUND" })).toMatchObject({
      deliveryStatus: "failed_terminal",
      failureCode: "dns_not_found",
    });
  });

  it("marks connectivity errors with connectivity cap", () => {
    expect(classifyWebhookRetry({ systemErrorCode: "ECONNREFUSED" })).toMatchObject({
      deliveryStatus: "failed_retryable",
      failureCode: "connection_refused",
      usesConnectivityCap: true,
    });
  });

  it("treats TLS errors as terminal security failures", () => {
    expect(classifyWebhookRetry({ systemErrorCode: "TLS_ERROR" })).toMatchObject({
      deliveryStatus: "failed_terminal",
      failureDomain: "security",
      failureCode: "tls_certificate_error",
    });
  });

  it("treats internal transient errors as retryable", () => {
    expect(classifyWebhookRetry({ internalErrorKind: "internal_transient" })).toMatchObject({
      deliveryStatus: "failed_retryable",
      failureDomain: "platform_internal",
      failureCode: "internal_transient",
    });
  });

  it("treats internal persistent errors as terminal", () => {
    expect(classifyWebhookRetry({ internalErrorKind: "internal_persistent" })).toMatchObject({
      deliveryStatus: "failed_terminal",
      failureDomain: "platform_internal",
      failureCode: "internal_persistent",
    });
  });
});