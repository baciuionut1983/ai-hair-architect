import type { WebhookDeliveryStatus } from "@/lib/contracts";

const ALLOWED_TRANSITIONS: Record<WebhookDeliveryStatus, WebhookDeliveryStatus[]> = {
  pending: ["dispatching", "canceled"],
  dispatching: ["delivered", "failed_retryable", "failed_terminal"],
  delivered: [],
  failed_retryable: ["dispatching", "canceled"],
  failed_terminal: [],
  canceled: [],
};

export function canTransitionWebhookDelivery(
  from: WebhookDeliveryStatus,
  to: WebhookDeliveryStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertWebhookDeliveryTransition(
  from: WebhookDeliveryStatus,
  to: WebhookDeliveryStatus,
): void {
  if (!canTransitionWebhookDelivery(from, to)) {
    throw new Error(`Webhook delivery transition ${from} -> ${to} is not allowed.`);
  }
}

export function isWebhookDeliveryTerminal(status: WebhookDeliveryStatus): boolean {
  return status === "delivered" || status === "failed_terminal" || status === "canceled";
}

export function getLeaseExpiryFailureStatus(): WebhookDeliveryStatus {
  return "failed_retryable";
}