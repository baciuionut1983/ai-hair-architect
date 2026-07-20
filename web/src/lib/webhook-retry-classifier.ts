import type {
  WebhookFailureCode,
  WebhookFailureDomain,
  WebhookRetryClassification,
} from "@/lib/contracts";

export interface RetryClassifierInput {
  httpStatus?: number | null;
  systemErrorCode?: string | null;
  internalErrorKind?: "internal_transient" | "internal_persistent" | null;
}

function retryable(
  failureDomain: WebhookFailureDomain,
  failureCode: WebhookFailureCode,
  usesConnectivityCap = false,
): WebhookRetryClassification {
  return {
    deliveryStatus: "failed_retryable",
    outcome: "retryable_failure",
    failureDomain,
    failureCode,
    usesConnectivityCap,
  };
}

function terminal(
  failureDomain: WebhookFailureDomain,
  failureCode: WebhookFailureCode,
): WebhookRetryClassification {
  return {
    deliveryStatus: "failed_terminal",
    outcome: "terminal_failure",
    failureDomain,
    failureCode,
    usesConnectivityCap: false,
  };
}

export function classifyWebhookRetry(input: RetryClassifierInput): WebhookRetryClassification {
  if (input.internalErrorKind === "internal_transient") {
    return retryable("platform_internal", "internal_transient");
  }

  if (input.internalErrorKind === "internal_persistent") {
    return terminal("platform_internal", "internal_persistent");
  }

  if (typeof input.httpStatus === "number") {
    if (input.httpStatus >= 200 && input.httpStatus < 300) {
      return {
        deliveryStatus: "delivered",
        outcome: "success",
        failureDomain: null,
        failureCode: "none",
        usesConnectivityCap: false,
      };
    }

    if (input.httpStatus >= 300 && input.httpStatus < 400) {
      return terminal("destination", "http_3xx_redirect_blocked");
    }

    if (input.httpStatus === 408) {
      return retryable("destination", "http_408");
    }

    if (input.httpStatus === 425) {
      return retryable("destination", "http_425");
    }

    if (input.httpStatus === 429) {
      return retryable("destination", "http_429");
    }

    if (input.httpStatus >= 500) {
      return retryable("destination", "http_5xx");
    }

    return terminal("destination", "http_4xx_non_retryable");
  }

  const code = input.systemErrorCode?.toUpperCase() ?? null;
  switch (code) {
    case "TIMEOUT":
    case "ETIMEDOUT":
    case "ERR_HTTP_REQUEST_TIMEOUT":
      return retryable("destination", "timeout");
    case "ECONNRESET":
      return retryable("destination", "connection_reset");
    case "ECONNREFUSED":
      return retryable("destination", "connection_refused", true);
    case "EHOSTUNREACH":
      return retryable("destination", "host_unreachable", true);
    case "ENETUNREACH":
      return retryable("destination", "network_unreachable", true);
    case "EAI_AGAIN":
      return retryable("destination", "dns_temporary");
    case "ENOTFOUND":
      return terminal("destination", "dns_not_found");
    case "BLOCKED_IP":
    case "URL_PRIVATE_IP":
      return terminal("security", "ssrf_blocked");
    case "INVALID_URL":
    case "UNSUPPORTED_PROTOCOL":
    case "URL_INVALID_FORMAT":
    case "URL_INVALID_SCHEME":
    case "URL_INVALID_PORT":
    case "URL_WITH_CREDENTIALS":
      return terminal("configuration", "invalid_url");
    case "TLS_ERROR":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "CERT_HAS_EXPIRED":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return terminal("security", "tls_certificate_error");
    default:
      return retryable("platform_internal", "internal_transient");
  }
}