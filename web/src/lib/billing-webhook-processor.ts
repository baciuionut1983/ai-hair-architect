import Stripe from "stripe";

import {
  findOrCreateBillingCustomer,
  findOwnerByProviderCustomerId,
  markWebhookEventStatus,
  recordWebhookEventIdempotently,
  runBillingWebhookTransaction,
  upsertPayment,
  upsertSubscriptionWithOrderingGuard,
  type BillingTransaction,
} from "@/lib/billing-repository";
import { findRecipientEmailForOwner } from "@/lib/email-repository";
import { sendTransactionalEmail } from "@/lib/email-service";
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

// M25: an internal-only side channel from inside the DB transaction back
// out to processVerifiedEvent, which sends the email strictly after the
// transaction has committed (an external network call must never happen
// while a DB transaction is open). Never part of the public
// BillingWebhookProcessResult returned by processBillingWebhookRequest --
// stripped before returning, so the route's contract is unchanged.
interface PendingBillingEmail {
  ownerUserId: string;
  kind: "payment_failed" | "subscription_deleted";
  providerEventId: string;
}

interface BillingWebhookProcessResultInternal extends BillingWebhookProcessResult {
  pendingEmail?: PendingBillingEmail;
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
const SUPPORTED_CHECKOUT_EVENT_TYPES = new Set(["checkout.session.completed"]);
const SUPPORTED_CHECKOUT_PLAN_KEYS = new Set(["pro", "salon", "business"]);
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
    const result = await runBillingWebhookTransaction(async (tx): Promise<BillingWebhookProcessResultInternal> => {
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
        // A retried Stripe event never reaches routeVerifiedEvent, so it
        // never sets pendingEmail either -- this is the sole guard against
        // sending the same billing email twice for a retried webhook.
        return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_DUPLICATE" };
      }

      return routeVerifiedEvent(event, claim.event.id, tx, now);
    });

    if (result.pendingEmail) {
      await sendBillingEmail(result.pendingEmail);
    }

    return { httpStatus: result.httpStatus, code: result.code };
  } catch {
    return { httpStatus: 500, code: "BILLING_WEBHOOK_INTERNAL_ERROR" };
  }
}

// Deliberately never throws. It runs after the billing transaction has
// already committed -- the subscription/payment state change is durable
// by this point. If this were allowed to throw, processVerifiedEvent's
// catch block would report 500 BILLING_WEBHOOK_INTERNAL_ERROR to Stripe
// for a webhook that actually succeeded, causing an unnecessary retry
// purely because of an email-side problem. sendTransactionalEmail already
// guarantees it won't throw; findRecipientEmailForOwner does not (it
// follows this codebase's normal repository convention of throwing a
// typed persistence error), so this wrapper is what closes that gap.
async function sendBillingEmail(pending: PendingBillingEmail): Promise<void> {
  try {
    const recipientEmail = await findRecipientEmailForOwner(pending.ownerUserId);
    if (!recipientEmail) return;

    const content =
      pending.kind === "payment_failed"
        ? {
            eventType: "billing.invoice.payment_failed",
            subject: "Payment failed for your subscription",
            text: "We were unable to process your latest payment. Please update your payment method to keep your subscription active.",
            idempotencyKey: `billing.payment_failed:${pending.providerEventId}`,
          }
        : {
            eventType: "billing.subscription.deleted",
            subject: "Your subscription has ended",
            text: "Your subscription has been canceled or has ended. You can resubscribe anytime from your account.",
            idempotencyKey: `billing.subscription_deleted:${pending.providerEventId}`,
          };

    await sendTransactionalEmail({
      ownerUserId: pending.ownerUserId,
      category: "billing",
      recipientEmail,
      relatedEntityType: "BillingWebhookEvent",
      relatedEntityId: pending.providerEventId,
      ...content,
    });
  } catch {
    // See the function-level comment above.
  }
}

async function routeVerifiedEvent(
  event: Stripe.Event,
  eventId: string,
  tx: BillingTransaction,
  now: Date,
): Promise<BillingWebhookProcessResultInternal> {
  if (SUPPORTED_SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    return processSubscriptionEvent(event, eventId, tx, now);
  }
  if (SUPPORTED_INVOICE_EVENT_TYPES.has(event.type)) {
    return processInvoiceEvent(event, eventId, tx, now);
  }
  if (SUPPORTED_CHECKOUT_EVENT_TYPES.has(event.type)) {
    return processCheckoutSessionCompletedEvent(event, eventId, tx, now);
  }

  await markWebhookEventStatus(eventId, { status: "ignored_unsupported" }, tx);
  return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_UNSUPPORTED" };
}

async function processSubscriptionEvent(
  event: Stripe.Event,
  eventId: string,
  tx: BillingTransaction,
  now: Date,
): Promise<BillingWebhookProcessResultInternal> {
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

  const pendingEmail: PendingBillingEmail | undefined =
    event.type === "customer.subscription.deleted"
      ? { ownerUserId: owner.ownerUserId, kind: "subscription_deleted", providerEventId: event.id }
      : undefined;

  return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED", pendingEmail };
}

async function processInvoiceEvent(
  event: Stripe.Event,
  eventId: string,
  tx: BillingTransaction,
  now: Date,
): Promise<BillingWebhookProcessResultInternal> {
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

  const pendingEmail: PendingBillingEmail | undefined = isPaid
    ? undefined
    : { ownerUserId: owner.ownerUserId, kind: "payment_failed", providerEventId: event.id };

  return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED", pendingEmail };
}

async function processCheckoutSessionCompletedEvent(
  event: Stripe.Event,
  eventId: string,
  tx: BillingTransaction,
  now: Date,
): Promise<BillingWebhookProcessResult> {
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.mode !== "subscription") {
    await markWebhookEventStatus(eventId, { status: "ignored_unsupported" }, tx);
    return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_UNSUPPORTED" };
  }

  const clientReferenceId = trimmedOrNull(session.client_reference_id);
  const metadataOwnerUserId = trimmedOrNull(session.metadata?.ownerUserId);
  const plan = trimmedOrNull(session.metadata?.plan);
  const providerCustomerId = extractStripeId(session.customer);
  const providerSubscriptionId = extractStripeId(session.subscription);

  const isMalformed =
    !clientReferenceId ||
    !metadataOwnerUserId ||
    clientReferenceId !== metadataOwnerUserId ||
    !plan ||
    !SUPPORTED_CHECKOUT_PLAN_KEYS.has(plan) ||
    !providerCustomerId ||
    !providerSubscriptionId;

  if (isMalformed) {
    await markWebhookEventStatus(
      eventId,
      { status: "failed_terminal", failureCode: "BILLING_WEBHOOK_EVENT_MALFORMED" },
      tx,
    );
    return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" };
  }

  const ownerUserId = clientReferenceId;

  const customer = await findOrCreateBillingCustomer(
    { ownerUserId, provider: "stripe", providerCustomerId },
    tx,
  );

  // Checkout completing does not itself confirm the subscription is active -- Stripe
  // does not include subscription status on this event without an extra API call, and
  // making one here would add live network I/O inside this atomic transaction. "incomplete"
  // records the linkage without granting access; customer.subscription.created/updated
  // remains the sole authority for the real status, applied through the same ordering guard.
  const upsert = await upsertSubscriptionWithOrderingGuard(
    {
      ownerUserId: customer.ownerUserId,
      billingCustomerId: customer.id,
      provider: "stripe",
      providerSubscriptionId,
      planKey: plan,
      status: "incomplete",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      eventCreatedAt: new Date(event.created * 1000),
      providerEventId: event.id,
    },
    tx,
  );

  if (!upsert.applied) {
    await markWebhookEventStatus(
      eventId,
      { status: "ignored_out_of_order", ownerUserId: customer.ownerUserId },
      tx,
    );
    return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_OUT_OF_ORDER" };
  }

  await markWebhookEventStatus(
    eventId,
    { status: "processed", processedAt: now, ownerUserId: customer.ownerUserId },
    tx,
  );
  return { httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" };
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

const INTERNAL_PLAN_KEYS = new Set(["pro", "salon", "business"]);

const PRICE_ID_ENV_VAR_TO_PLAN_KEY: Record<string, string> = {
  STRIPE_PRICE_PRO: "pro",
  STRIPE_PRICE_SALON: "salon",
  STRIPE_PRICE_BUSINESS: "business",
};

/**
 * Never returns a raw Stripe price id as the internal planKey -- only one
 * of "pro"/"salon"/"business", or "unknown" (fail-closed; toSubscriptionRecord
 * in the subscription route treats "unknown" the same as any other
 * unrecognized plan, falling back to the free/no-entitlement record, never
 * granting access for a plan it cannot positively identify).
 *
 * Order: Stripe's own price.lookup_key first, but only when it already is
 * one of our own plan keys verbatim -- then a reverse lookup of price.id
 * against our own STRIPE_PRICE_PRO/SALON/BUSINESS env vars, so this stays
 * correct even when a Stripe Price was never given a matching lookup_key in
 * the Dashboard.
 */
export function resolvePlanKey(subscription: Stripe.Subscription, env: NodeJS.ProcessEnv = process.env): string {
  const price = subscription.items.data[0]?.price;
  if (!price) return "unknown";

  const lookupKey = price.lookup_key;
  if (lookupKey && INTERNAL_PLAN_KEYS.has(lookupKey)) {
    return lookupKey;
  }

  const priceId = price.id;
  for (const [variable, planKey] of Object.entries(PRICE_ID_ENV_VAR_TO_PLAN_KEY)) {
    const configuredPriceId = String(env[variable] ?? "").trim();
    if (configuredPriceId && configuredPriceId === priceId) {
      return planKey;
    }
  }

  return "unknown";
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
