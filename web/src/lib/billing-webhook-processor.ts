import Stripe from "stripe";

import {
  findOwnerByProviderCustomerId,
  markWebhookEventStatus,
  recordWebhookEventIdempotently,
  runBillingWebhookTransaction,
  upsertPayment,
  upsertSubscriptionWithOrderingGuard,
  type BillingTransaction,
} from "@/lib/billing-repository";
import type { BillingSubscriptionStatus } from "@prisma/client";

export type BillingProcessingMode = "disabled" | "webhook_only" | "enabled";

export type BillingWebhookResultCode =
  | "BILLING_WEBHOOK_SIGNATURE_MISSING"
  | "BILLING_WEBHOOK_SIGNATURE_INVALID"
  | "BILLING_PROCESSING_DISABLED"
  | "BILLING_WEBHOOK_EVENT_MALFORMED"
  | "BILLING_WEBHOOK_EVENT_UNSUPPORTED"
  | "BILLING_WEBHOOK_EVENT_DUPLICATE"
  | "BILLING_CUSTOMER_NOT_MAPPED"
  | "BILLING_WEBHOOK_EVENT_OUT_OF_ORDER"
  | "BILLING_WEBHOOK_EVENT_PROCESSED"
  | "BILLING_WEBHOOK_INTERNAL_ERROR";

export interface BillingWebhookProcessResult {
  httpStatus: 200 | 400 | 500 | 503;
  code: BillingWebhookResultCode;
}

export const BILLING_WEBHOOK_RESULT_MESSAGES: Record<BillingWebhookResultCode, string> = {
  BILLING_WEBHOOK_SIGNATURE_MISSING: "Stripe-Signature header is required.",
  BILLING_WEBHOOK_SIGNATURE_INVALID: "Stripe webhook signature could not be verified.",
  BILLING_PROCESSING_DISABLED: "Billing webhook processing is temporarily disabled.",
  BILLING_WEBHOOK_EVENT_MALFORMED: "Stripe event did not contain the required fields.",
  BILLING_WEBHOOK_EVENT_UNSUPPORTED: "Stripe event type is not processed.",
  BILLING_WEBHOOK_EVENT_DUPLICATE: "Stripe event was already processed.",
  BILLING_CUSTOMER_NOT_MAPPED: "Stripe customer is not mapped to an owner.",
  BILLING_WEBHOOK_EVENT_OUT_OF_ORDER: "Stripe event was superseded by a newer event.",
  BILLING_WEBHOOK_EVENT_PROCESSED: "Stripe event was processed.",
  BILLING_WEBHOOK_INTERNAL_ERROR: "Billing webhook processing failed.",
};

const SUPPORTED_SUBSCRIPTION_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const SUPPORTED_INVOICE_EVENT_TYPES = new Set(["invoice.paid", "invoice.payment_failed"]);
const TERMINAL_EVENT_STATUSES = new Set([
  "processed",
  "ignored_out_of_order",
  "ignored_unsupported",
  "failed_terminal",
]);
const SUBSCRIPTION_STATUS_VALUES = new Set<BillingSubscriptionStatus>([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

export function resolveBillingProcessingMode(env: NodeJS.ProcessEnv = process.env): BillingProcessingMode {
  const raw = String(env.BILLING_PROCESSING_MODE ?? "").trim();
  if (raw === "webhook_only" || raw === "enabled") return raw;
  return "disabled";
}

export interface ProcessBillingWebhookInput {
  rawBody: string;
  signatureHeader: string | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export async function processBillingWebhookRequest(
  input: ProcessBillingWebhookInput,
): Promise<BillingWebhookProcessResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();

  if (!input.signatureHeader) {
    return { httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_MISSING" };
  }

  const event = verifyStripeEvent(input.rawBody, input.signatureHeader, env);
  if (!event) {
    return { httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_INVALID" };
  }

  const mode = resolveBillingProcessingMode(env);
  if (mode === "disabled") {
    return { httpStatus: 503, code: "BILLING_PROCESSING_DISABLED" };
  }

  return processVerifiedEvent(event, now);
}

function verifyStripeEvent(
  rawBody: string,
  signatureHeader: string,
  env: NodeJS.ProcessEnv,
): Stripe.Event | null {
  const secretKey = String(env.STRIPE_SECRET_KEY ?? "").trim();
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!secretKey || !webhookSecret) return null;

  try {
    const stripe = new Stripe(secretKey);
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
  } catch {
    return null;
  }
}

async function processVerifiedEvent(event: Stripe.Event, now: Date): Promise<BillingWebhookProcessResult> {
  try {
    return await runBillingWebhookTransaction(async (tx) => {
      const claim = await recordWebhookEventIdempotently(
        {
          provider: "stripe",
          providerEventId: event.id,
          eventType: event.type,
          apiVersion: event.api_version ?? null,
          eventCreatedAt: new Date(event.created * 1000),
        },
        tx,
      );

      if (claim.outcome === "duplicate" && TERMINAL_EVENT_STATUSES.has(claim.event.status)) {
        return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_DUPLICATE" };
      }

      return routeVerifiedEvent(event, claim.event.id, tx, now);
    });
  } catch {
    return { httpStatus: 500, code: "BILLING_WEBHOOK_INTERNAL_ERROR" };
  }
}

async function routeVerifiedEvent(
  event: Stripe.Event,
  eventId: string,
  tx: BillingTransaction,
  now: Date,
): Promise<BillingWebhookProcessResult> {
  if (SUPPORTED_SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    return processSubscriptionEvent(event, eventId, tx, now);
  }
  if (SUPPORTED_INVOICE_EVENT_TYPES.has(event.type)) {
    return processInvoiceEvent(event, eventId, tx, now);
  }

  await markWebhookEventStatus(eventId, { status: "ignored_unsupported" }, tx);
  return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_UNSUPPORTED" };
}

async function processSubscriptionEvent(
  event: Stripe.Event,
  eventId: string,
  tx: BillingTransaction,
  now: Date,
): Promise<BillingWebhookProcessResult> {
  const subscription = event.data.object as Stripe.Subscription;
  const providerCustomerId = extractStripeId(subscription.customer);
  const status = isKnownSubscriptionStatus(subscription.status) ? subscription.status : null;

  if (!providerCustomerId || !subscription.id || !status) {
    await markWebhookEventStatus(
      eventId,
      { status: "failed_terminal", failureCode: "BILLING_WEBHOOK_EVENT_MALFORMED" },
      tx,
    );
    return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" };
  }

  const owner = await findOwnerByProviderCustomerId("stripe", providerCustomerId, tx);
  if (!owner) {
    await markWebhookEventStatus(
      eventId,
      { status: "failed_terminal", failureCode: "BILLING_CUSTOMER_NOT_MAPPED" },
      tx,
    );
    return { httpStatus: 200, code: "BILLING_CUSTOMER_NOT_MAPPED" };
  }

  const upsert = await upsertSubscriptionWithOrderingGuard(
    {
      ownerUserId: owner.ownerUserId,
      billingCustomerId: owner.billingCustomerId,
      provider: "stripe",
      providerSubscriptionId: subscription.id,
      planKey: resolvePlanKey(subscription),
      status,
      currentPeriodStart: toDateOrNull(subscription.items.data[0]?.current_period_start),
      currentPeriodEnd: toDateOrNull(subscription.items.data[0]?.current_period_end),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      canceledAt: toDateOrNull(subscription.canceled_at),
      eventCreatedAt: new Date(event.created * 1000),
      providerEventId: event.id,
    },
    tx,
  );

  if (!upsert.applied) {
    await markWebhookEventStatus(
      eventId,
      { status: "ignored_out_of_order", ownerUserId: owner.ownerUserId },
      tx,
    );
    return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_OUT_OF_ORDER" };
  }

  await markWebhookEventStatus(
    eventId,
    { status: "processed", processedAt: now, ownerUserId: owner.ownerUserId },
    tx,
  );
  return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" };
}

async function processInvoiceEvent(
  event: Stripe.Event,
  eventId: string,
  tx: BillingTransaction,
  now: Date,
): Promise<BillingWebhookProcessResult> {
  const invoice = event.data.object as Stripe.Invoice;
  const providerCustomerId = extractStripeId(invoice.customer);

  if (!providerCustomerId || !invoice.id) {
    await markWebhookEventStatus(
      eventId,
      { status: "failed_terminal", failureCode: "BILLING_WEBHOOK_EVENT_MALFORMED" },
      tx,
    );
    return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" };
  }

  const owner = await findOwnerByProviderCustomerId("stripe", providerCustomerId, tx);
  if (!owner) {
    await markWebhookEventStatus(
      eventId,
      { status: "failed_terminal", failureCode: "BILLING_CUSTOMER_NOT_MAPPED" },
      tx,
    );
    return { httpStatus: 200, code: "BILLING_CUSTOMER_NOT_MAPPED" };
  }

  const isPaid = event.type === "invoice.paid";
  await upsertPayment(
    {
      ownerUserId: owner.ownerUserId,
      billingSubscriptionId: null,
      provider: "stripe",
      providerInvoiceId: invoice.id,
      providerPaymentIntentId: null,
      amountCents: isPaid ? invoice.amount_paid : invoice.amount_due,
      currency: invoice.currency,
      status: isPaid ? "succeeded" : "failed",
      paidAt: isPaid ? now : null,
      failedAt: isPaid ? null : now,
      failureCode: isPaid ? null : sanitizeInvoiceFailureCode(invoice),
    },
    tx,
  );

  await markWebhookEventStatus(
    eventId,
    { status: "processed", processedAt: now, ownerUserId: owner.ownerUserId },
    tx,
  );
  return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" };
}

function resolvePlanKey(subscription: Stripe.Subscription): string {
  const price = subscription.items.data[0]?.price;
  return price?.lookup_key || price?.id || "unknown";
}

function sanitizeInvoiceFailureCode(invoice: Stripe.Invoice): string {
  return invoice.last_finalization_error?.code ?? "payment_failed";
}

function isKnownSubscriptionStatus(value: string): value is BillingSubscriptionStatus {
  return SUBSCRIPTION_STATUS_VALUES.has(value as BillingSubscriptionStatus);
}

function toDateOrNull(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000) : null;
}

function extractStripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}
