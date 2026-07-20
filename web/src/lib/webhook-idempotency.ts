import crypto from "crypto";

const PRODUCER_KEY_PATTERN = /^[a-z0-9._-]+\/[a-z0-9._-]+\/[A-Za-z0-9._:-]+$/;

export interface ProducerIdempotencyParts {
  producer: string;
  operation: string;
  stableId: string;
}

export function buildProducerIdempotencyKey(parts: ProducerIdempotencyParts): string {
  const value = `${parts.producer}/${parts.operation}/${parts.stableId}`;
  assertNamespacedProducerIdempotencyKey(value);
  return value;
}

export function assertNamespacedProducerIdempotencyKey(value: string): void {
  if (!PRODUCER_KEY_PATTERN.test(value)) {
    throw new Error("Producer idempotency key must be namespaced as producer/operation/stable-id.");
  }
}

export function buildDeliveryIdempotencyKey(webhookEndpointId: string, webhookEventId: string): string {
  return crypto
    .createHash("sha256")
    .update(`delivery/${webhookEndpointId}/${webhookEventId}`, "utf8")
    .digest("hex");
}