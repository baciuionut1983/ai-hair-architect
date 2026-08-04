import { randomUUID } from "crypto";

import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  processBillingWebhookRequest,
  resolveBillingProcessingMode,
} from "./billing-webhook-processor";
import { findOrCreateBillingCustomer } from "./billing-repository";
import { prisma } from "@/lib/prisma";

const TEST_WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests";
const TEST_SECRET_KEY = "sk_test_dummy_for_unit_tests";

function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STRIPE_SECRET_KEY: TEST_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    BILLING_PROCESSING_MODE: "webhook_only",
    ...overrides,
  };
}

function signedRequest(
  payload: unknown,
  options: { secret?: string; timestamp?: number } = {},
): { rawBody: string; signatureHeader: string } {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signatureHeader = Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: options.secret ?? TEST_WEBHOOK_SECRET,
    timestamp: options.timestamp,
  });
  return { rawBody, signatureHeader };
}

function subscriptionEvent(overrides: {
  id?: string;
  type?: string;
  created?: number;
  subscriptionId?: string;
  customerId?: string;
  status?: string;
  lookupKey?: string | null;
  priceId?: string;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: number | null;
} = {}) {
  const created = overrides.created ?? Math.floor(Date.now() / 1000);
  return {
    id: overrides.id ?? `evt_${randomUUID()}`,
    object: "event",
    api_version: "2025-01-01",
    created,
    type: overrides.type ?? "customer.subscription.updated",
    data: {
      object: {
        id: overrides.subscriptionId ?? `sub_${randomUUID()}`,
        object: "subscription",
        customer: overrides.customerId ?? `cus_${randomUUID()}`,
        status: overrides.status ?? "active",
        cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
        canceled_at: overrides.canceledAt ?? null,
        items: {
          object: "list",
          data: [
            {
              id: `si_${randomUUID()}`,
              current_period_start: created,
              current_period_end: created + 2_592_000,
              price: { id: overrides.priceId ?? "price_test", lookup_key: overrides.lookupKey ?? "pro_monthly" },
            },
          ],
        },
      },
    },
  };
}

function invoiceEvent(overrides: {
  id?: string;
  type?: string;
  created?: number;
  invoiceId?: string;
  customerId?: string;
  amountPaid?: number;
  amountDue?: number;
  currency?: string;
  failureCode?: string;
} = {}) {
  const created = overrides.created ?? Math.floor(Date.now() / 1000);
  return {
    id: overrides.id ?? `evt_${randomUUID()}`,
    object: "event",
    created,
    type: overrides.type ?? "invoice.paid",
    data: {
      object: {
        id: overrides.invoiceId ?? `in_${randomUUID()}`,
        object: "invoice",
        customer: overrides.customerId ?? `cus_${randomUUID()}`,
        amount_paid: overrides.amountPaid ?? 1999,
        amount_due: overrides.amountDue ?? 1999,
        currency: overrides.currency ?? "usd",
        last_finalization_error: overrides.failureCode ? { code: overrides.failureCode } : null,
      },
    },
  };
}

function checkoutSessionEvent(overrides: {
  id?: string;
  created?: number;
  mode?: string;
  clientReferenceId?: string | null;
  ownerUserId?: string | null;
  plan?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
} = {}) {
  const created = overrides.created ?? Math.floor(Date.now() / 1000);
  const metadata: Record<string, string> = {};
  if (overrides.ownerUserId !== null) metadata.ownerUserId = overrides.ownerUserId ?? "owner-default";
  if (overrides.plan !== null) metadata.plan = overrides.plan ?? "pro";

  return {
    id: overrides.id ?? `evt_${randomUUID()}`,
    object: "event",
    created,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${randomUUID()}`,
        object: "checkout.session",
        mode: overrides.mode ?? "subscription",
        client_reference_id: overrides.clientReferenceId === null ? null : overrides.clientReferenceId ?? "owner-default",
        customer: overrides.customerId === null ? null : overrides.customerId ?? "cus_default",
        subscription: overrides.subscriptionId === null ? null : overrides.subscriptionId ?? `sub_${randomUUID()}`,
        metadata,
      },
    },
  };
}

describe("billing-webhook-processor: signature verification (no database required)", () => {
  it("accepts a validly signed event and proceeds past signature verification", async () => {
    const { rawBody, signatureHeader } = signedRequest(subscriptionEvent());

    const result = await processBillingWebhookRequest({
      rawBody,
      signatureHeader,
      env: testEnv({ BILLING_PROCESSING_MODE: "disabled" }),
    });

    expect(result).toEqual({ httpStatus: 503, code: "BILLING_PROCESSING_DISABLED" });
  });

  it("rejects when the body is mutated after signing", async () => {
    const { rawBody, signatureHeader } = signedRequest(subscriptionEvent({ status: "active" }));
    const tampered = rawBody.replace('"active"', '"canceled"');

    const result = await processBillingWebhookRequest({ rawBody: tampered, signatureHeader, env: testEnv() });

    expect(result).toEqual({ httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_INVALID" });
  });

  it("rejects a missing signature header", async () => {
    const rawBody = JSON.stringify(subscriptionEvent());

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader: null, env: testEnv() });

    expect(result).toEqual({ httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_MISSING" });
  });

  it("rejects a malformed signature header", async () => {
    const rawBody = JSON.stringify(subscriptionEvent());

    const result = await processBillingWebhookRequest({
      rawBody,
      signatureHeader: "not-a-valid-stripe-signature-header",
      env: testEnv(),
    });

    expect(result).toEqual({ httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_INVALID" });
  });

  it("rejects a signature produced with the wrong secret", async () => {
    const { rawBody, signatureHeader } = signedRequest(subscriptionEvent(), { secret: "whsec_wrong_secret" });

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });

    expect(result).toEqual({ httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_INVALID" });
  });

  it("rejects a stale signature outside the tolerance window", async () => {
    const { rawBody, signatureHeader } = signedRequest(subscriptionEvent(), {
      timestamp: Math.floor(Date.now() / 1000) - 1000,
    });

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });

    expect(result).toEqual({ httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_INVALID" });
  });

  it("rejects a malformed raw body even with a signature computed over that exact malformed text", async () => {
    const { rawBody, signatureHeader } = signedRequest("not-valid-json{{{");

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });

    expect(result).toEqual({ httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_INVALID" });
  });

  it("rejects when Stripe credentials are not configured, never falling back to an unsigned path", async () => {
    const { rawBody, signatureHeader } = signedRequest(subscriptionEvent());

    const result = await processBillingWebhookRequest({
      rawBody,
      signatureHeader,
      env: testEnv({ STRIPE_WEBHOOK_SECRET: "" }),
    });

    expect(result).toEqual({ httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_INVALID" });
  });
});

describe("billing-webhook-processor: processing mode (no database required)", () => {
  it("resolves webhook_only and enabled explicitly", () => {
    expect(resolveBillingProcessingMode({ ...process.env, BILLING_PROCESSING_MODE: "webhook_only" })).toBe(
      "webhook_only",
    );
    expect(resolveBillingProcessingMode({ ...process.env, BILLING_PROCESSING_MODE: "enabled" })).toBe("enabled");
  });

  it("treats missing, empty, and malformed values as disabled", () => {
    const envWithoutMode = { ...process.env };
    delete envWithoutMode.BILLING_PROCESSING_MODE;
    expect(resolveBillingProcessingMode(envWithoutMode)).toBe("disabled");
    expect(resolveBillingProcessingMode({ ...process.env, BILLING_PROCESSING_MODE: "" })).toBe("disabled");
    expect(resolveBillingProcessingMode({ ...process.env, BILLING_PROCESSING_MODE: "garbage" })).toBe("disabled");
    expect(resolveBillingProcessingMode({ ...process.env, BILLING_PROCESSING_MODE: "Enabled" })).toBe("disabled");
  });

  it("disabled mode returns 503 only after signature verification succeeds", async () => {
    const { rawBody, signatureHeader } = signedRequest(subscriptionEvent());

    const result = await processBillingWebhookRequest({
      rawBody,
      signatureHeader,
      env: testEnv({ BILLING_PROCESSING_MODE: "disabled" }),
    });

    expect(result).toEqual({ httpStatus: 503, code: "BILLING_PROCESSING_DISABLED" });
  });

  it("unsigned traffic still fails as a signature error even in disabled mode", async () => {
    const rawBody = JSON.stringify(subscriptionEvent());

    const result = await processBillingWebhookRequest({
      rawBody,
      signatureHeader: null,
      env: testEnv({ BILLING_PROCESSING_MODE: "disabled" }),
    });

    expect(result).toEqual({ httpStatus: 400, code: "BILLING_WEBHOOK_SIGNATURE_MISSING" });
  });
});

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite("billing-webhook-processor (real Postgres)", () => {
  const owners = new Set<string>();
  const webhookEventIds = new Set<string>();

  afterEach(async () => {
    await prisma.billingWebhookEvent.deleteMany({ where: { id: { in: [...webhookEventIds] } } });
    await prisma.billingPayment.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.billingSubscription.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.billingCustomer.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    // M25: invoice.payment_failed / customer.subscription.deleted now also
    // create an EmailNotification row (status "skipped" in this test
    // environment, since EMAIL_PROCESSING_MODE is never enabled here) --
    // it must be cleared before the owning User can be deleted.
    await prisma.emailNotification.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
    webhookEventIds.clear();
  });

  async function createOwnerWithCustomer(): Promise<{ ownerUserId: string; providerCustomerId: string }> {
    const ownerUserId = randomUUID();
    owners.add(ownerUserId);
    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `${ownerUserId}@billing-webhook.test`,
        passwordHash: "test",
        role: "professional",
        locale: "en",
      },
    });
    const providerCustomerId = `cus_${ownerUserId}`;
    await findOrCreateBillingCustomer({ ownerUserId, provider: "stripe", providerCustomerId });
    return { ownerUserId, providerCustomerId };
  }

  it("processes a supported customer.subscription.created event end-to-end", async () => {
    const { ownerUserId, providerCustomerId } = await createOwnerWithCustomer();
    const event = subscriptionEvent({ type: "customer.subscription.created", customerId: providerCustomerId });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });
    await expect(
      prisma.billingSubscription.findUnique({
        where: { provider_providerSubscriptionId: { provider: "stripe", providerSubscriptionId: event.data.object.id } },
      }),
    ).resolves.toMatchObject({ ownerUserId, status: "active", planKey: "pro_monthly" });
    await expect(
      prisma.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
      }),
    ).resolves.toMatchObject({ status: "processed", ownerUserId });
  });

  it("processes customer.subscription.deleted, applying the canceled status", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const subscriptionId = `sub_${randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);

    const created = subscriptionEvent({
      type: "customer.subscription.created",
      customerId: providerCustomerId,
      subscriptionId,
      created: now,
    });
    const { rawBody: rawBody1, signatureHeader: sig1 } = signedRequest(created);
    await processBillingWebhookRequest({ rawBody: rawBody1, signatureHeader: sig1, env: testEnv() });
    webhookEventIds.add(created.id);

    const deleted = subscriptionEvent({
      type: "customer.subscription.deleted",
      customerId: providerCustomerId,
      subscriptionId,
      status: "canceled",
      canceledAt: now + 10,
      created: now + 10,
    });
    const { rawBody: rawBody2, signatureHeader: sig2 } = signedRequest(deleted);
    const result = await processBillingWebhookRequest({ rawBody: rawBody2, signatureHeader: sig2, env: testEnv() });
    webhookEventIds.add(deleted.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });
    await expect(
      prisma.billingSubscription.findUnique({
        where: { provider_providerSubscriptionId: { provider: "stripe", providerSubscriptionId: subscriptionId } },
      }),
    ).resolves.toMatchObject({ status: "canceled" });

    const emails = await prisma.emailNotification.findMany({ where: { idempotencyKey: `billing.subscription_deleted:${deleted.id}` } });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ category: "billing", status: "skipped" });

    // Redelivering the same Stripe event must never queue a second email --
    // it hits the existing BillingWebhookEvent dedup path before
    // routeVerifiedEvent (and therefore pendingEmail) is ever reached.
    const { rawBody: rawBody3, signatureHeader: sig3 } = signedRequest(deleted);
    const retried = await processBillingWebhookRequest({ rawBody: rawBody3, signatureHeader: sig3, env: testEnv() });
    expect(retried).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_DUPLICATE" });
    await expect(
      prisma.emailNotification.findMany({ where: { idempotencyKey: `billing.subscription_deleted:${deleted.id}` } }),
    ).resolves.toHaveLength(1);
  });

  it("processes invoice.paid", async () => {
    const { ownerUserId, providerCustomerId } = await createOwnerWithCustomer();
    const event = invoiceEvent({ type: "invoice.paid", customerId: providerCustomerId, amountPaid: 4900 });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });
    await expect(
      prisma.billingPayment.findUnique({
        where: { provider_providerInvoiceId: { provider: "stripe", providerInvoiceId: event.data.object.id } },
      }),
    ).resolves.toMatchObject({ ownerUserId, status: "succeeded", amountCents: 4900 });

    // invoice.paid is deliberately not one of the two email-triggering
    // events approved for M25.
    await expect(
      prisma.emailNotification.findMany({ where: { idempotencyKey: `billing.payment_failed:${event.id}` } }),
    ).resolves.toHaveLength(0);
  });

  it("processes invoice.payment_failed with a sanitized structural failure code", async () => {
    const { ownerUserId, providerCustomerId } = await createOwnerWithCustomer();
    const event = invoiceEvent({
      type: "invoice.payment_failed",
      customerId: providerCustomerId,
      failureCode: "card_declined",
    });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });
    await expect(
      prisma.billingPayment.findUnique({
        where: { provider_providerInvoiceId: { provider: "stripe", providerInvoiceId: event.data.object.id } },
      }),
    ).resolves.toMatchObject({ ownerUserId, status: "failed", failureCode: "card_declined" });

    const emails = await prisma.emailNotification.findMany({ where: { idempotencyKey: `billing.payment_failed:${event.id}` } });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ ownerUserId, category: "billing", status: "skipped", recipientEmail: expect.stringContaining("@billing-webhook.test") });
  });

  it("records an unrecognized event type as ignored_unsupported with no mutation", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const event = subscriptionEvent({ type: "customer.updated", customerId: providerCustomerId });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_UNSUPPORTED" });
    await expect(
      prisma.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
      }),
    ).resolves.toMatchObject({ status: "ignored_unsupported" });
    await expect(prisma.billingSubscription.count({
      where: { providerSubscriptionId: event.data.object.id },
    })).resolves.toBe(0);
  });

  it("processes checkout.session.completed end-to-end, linking the customer and recording the subscription id without granting active status", async () => {
    const ownerUserId = randomUUID();
    owners.add(ownerUserId);
    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `${ownerUserId}@billing-webhook.test`,
        passwordHash: "test",
        role: "professional",
        locale: "en",
      },
    });
    const providerCustomerId = `cus_${ownerUserId}`;
    const subscriptionId = `sub_${randomUUID()}`;

    const event = checkoutSessionEvent({
      clientReferenceId: ownerUserId,
      ownerUserId,
      plan: "pro",
      customerId: providerCustomerId,
      subscriptionId,
    });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });
    await expect(
      prisma.billingCustomer.findUnique({ where: { ownerUserId_provider: { ownerUserId, provider: "stripe" } } }),
    ).resolves.toMatchObject({ providerCustomerId });
    await expect(
      prisma.billingSubscription.findUnique({
        where: { provider_providerSubscriptionId: { provider: "stripe", providerSubscriptionId: subscriptionId } },
      }),
    ).resolves.toMatchObject({ ownerUserId, status: "incomplete", planKey: "pro" });
    await expect(
      prisma.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
      }),
    ).resolves.toMatchObject({ status: "processed", ownerUserId });
  });

  it("never grants active status from checkout.session.completed alone, regardless of plan", async () => {
    const ownerUserId = randomUUID();
    owners.add(ownerUserId);
    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `${ownerUserId}@billing-webhook.test`,
        passwordHash: "test",
        role: "professional",
        locale: "en",
      },
    });
    const providerCustomerId = `cus_${ownerUserId}`;
    const subscriptionId = `sub_${randomUUID()}`;

    const event = checkoutSessionEvent({
      clientReferenceId: ownerUserId,
      ownerUserId,
      plan: "business",
      customerId: providerCustomerId,
      subscriptionId,
    });
    const { rawBody, signatureHeader } = signedRequest(event);

    await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    const subscription = await prisma.billingSubscription.findUnique({
      where: { provider_providerSubscriptionId: { provider: "stripe", providerSubscriptionId: subscriptionId } },
    });
    expect(subscription?.status).not.toBe("active");
    expect(subscription?.status).toBe("incomplete");
  });

  it("upgrades to the real status once customer.subscription.created arrives after checkout.session.completed", async () => {
    const ownerUserId = randomUUID();
    owners.add(ownerUserId);
    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `${ownerUserId}@billing-webhook.test`,
        passwordHash: "test",
        role: "professional",
        locale: "en",
      },
    });
    const providerCustomerId = `cus_${ownerUserId}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const checkoutTime = Math.floor(Date.now() / 1000);

    const checkoutEvent = checkoutSessionEvent({
      clientReferenceId: ownerUserId,
      ownerUserId,
      plan: "pro",
      customerId: providerCustomerId,
      subscriptionId,
      created: checkoutTime,
    });
    const { rawBody: rb1, signatureHeader: sig1 } = signedRequest(checkoutEvent);
    const checkoutResult = await processBillingWebhookRequest({ rawBody: rb1, signatureHeader: sig1, env: testEnv() });
    webhookEventIds.add(checkoutEvent.id);
    expect(checkoutResult).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });

    const subscriptionCreated = subscriptionEvent({
      type: "customer.subscription.created",
      customerId: providerCustomerId,
      subscriptionId,
      status: "active",
      created: checkoutTime + 10,
    });
    const { rawBody: rb2, signatureHeader: sig2 } = signedRequest(subscriptionCreated);
    const subscriptionResult = await processBillingWebhookRequest({ rawBody: rb2, signatureHeader: sig2, env: testEnv() });
    webhookEventIds.add(subscriptionCreated.id);
    expect(subscriptionResult).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });

    await expect(
      prisma.billingSubscription.findUnique({
        where: { provider_providerSubscriptionId: { provider: "stripe", providerSubscriptionId: subscriptionId } },
      }),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("returns duplicate for a redelivered checkout.session.completed event without reprocessing", async () => {
    const { ownerUserId, providerCustomerId } = await createOwnerWithCustomer();
    const event = checkoutSessionEvent({ clientReferenceId: ownerUserId, ownerUserId, customerId: providerCustomerId });
    const { rawBody, signatureHeader } = signedRequest(event);

    const first = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);
    const second = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });

    expect(first).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });
    expect(second).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_DUPLICATE" });
    await expect(
      prisma.billingWebhookEvent.count({ where: { provider: "stripe", providerEventId: event.id } }),
    ).resolves.toBe(1);
  });

  it("rejects checkout.session.completed missing client_reference_id, with no subscription created", async () => {
    const event = checkoutSessionEvent({ clientReferenceId: null, ownerUserId: randomUUID() });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" });
    await expect(
      prisma.billingSubscription.count({ where: { providerSubscriptionId: event.data.object.subscription as string } }),
    ).resolves.toBe(0);
  });

  it("rejects checkout.session.completed missing metadata.ownerUserId", async () => {
    const event = checkoutSessionEvent({ clientReferenceId: randomUUID(), ownerUserId: null });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" });
  });

  it("rejects checkout.session.completed when client_reference_id contradicts metadata.ownerUserId", async () => {
    const event = checkoutSessionEvent({ clientReferenceId: "owner-a", ownerUserId: "owner-b" });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" });
    await expect(
      prisma.billingSubscription.count({ where: { ownerUserId: { in: ["owner-a", "owner-b"] } } }),
    ).resolves.toBe(0);
  });

  it("rejects checkout.session.completed with an unrecognized plan", async () => {
    const ownerUserId = randomUUID();
    const event = checkoutSessionEvent({ clientReferenceId: ownerUserId, ownerUserId, plan: "enterprise" });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" });
  });

  it("rejects checkout.session.completed missing the Stripe customer id", async () => {
    const ownerUserId = randomUUID();
    const event = checkoutSessionEvent({ clientReferenceId: ownerUserId, ownerUserId, customerId: null });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" });
  });

  it("rejects checkout.session.completed missing the Stripe subscription id", async () => {
    const ownerUserId = randomUUID();
    const event = checkoutSessionEvent({ clientReferenceId: ownerUserId, ownerUserId, subscriptionId: null });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" });
  });

  it("ignores a non-subscription-mode checkout session as unsupported", async () => {
    const ownerUserId = randomUUID();
    const event = checkoutSessionEvent({ mode: "payment", clientReferenceId: ownerUserId, ownerUserId });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_UNSUPPORTED" });
    await expect(
      prisma.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
      }),
    ).resolves.toMatchObject({ status: "ignored_unsupported" });
  });

  it("ignores an out-of-order checkout.session.completed that is older than an already-applied subscription event", async () => {
    const { ownerUserId, providerCustomerId } = await createOwnerWithCustomer();
    const subscriptionId = `sub_${randomUUID()}`;
    const sameTime = Math.floor(Date.now() / 1000);

    const newerSubscriptionEvent = subscriptionEvent({
      type: "customer.subscription.created",
      customerId: providerCustomerId,
      subscriptionId,
      status: "trialing",
      created: sameTime,
    });
    const { rawBody: rb1, signatureHeader: sig1 } = signedRequest(newerSubscriptionEvent);
    await processBillingWebhookRequest({ rawBody: rb1, signatureHeader: sig1, env: testEnv() });
    webhookEventIds.add(newerSubscriptionEvent.id);

    const staleCheckout = checkoutSessionEvent({
      clientReferenceId: ownerUserId,
      ownerUserId,
      customerId: providerCustomerId,
      subscriptionId,
      created: sameTime - 100,
    });
    const { rawBody: rb2, signatureHeader: sig2 } = signedRequest(staleCheckout);
    const staleResult = await processBillingWebhookRequest({ rawBody: rb2, signatureHeader: sig2, env: testEnv() });
    webhookEventIds.add(staleCheckout.id);

    expect(staleResult).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_OUT_OF_ORDER" });
    await expect(
      prisma.billingSubscription.findUnique({
        where: { provider_providerSubscriptionId: { provider: "stripe", providerSubscriptionId: subscriptionId } },
      }),
    ).resolves.toMatchObject({ status: "trialing" });
  });

  it("rolls back with no partial writes when checkout.session.completed conflicts with an existing customer mapping", async () => {
    const { ownerUserId } = await createOwnerWithCustomer();
    const conflictingCustomerId = `cus_conflict_${randomUUID()}`;
    const event = checkoutSessionEvent({
      clientReferenceId: ownerUserId,
      ownerUserId,
      customerId: conflictingCustomerId,
    });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });

    expect(result).toEqual({ httpStatus: 500, code: "BILLING_WEBHOOK_INTERNAL_ERROR" });
    await expect(
      prisma.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.billingSubscription.count({ where: { providerSubscriptionId: event.data.object.subscription as string } }),
    ).resolves.toBe(0);
  });

  it("classifies an unmapped customer as durably failed_terminal and acknowledges 200, with no mutation", async () => {
    const event = subscriptionEvent({ customerId: `cus_never_mapped_${randomUUID()}` });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_CUSTOMER_NOT_MAPPED" });
    await expect(
      prisma.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
      }),
    ).resolves.toMatchObject({ status: "failed_terminal", lastFailureCode: "BILLING_CUSTOMER_NOT_MAPPED", ownerUserId: null });
    await expect(prisma.billingSubscription.count({
      where: { providerSubscriptionId: event.data.object.id },
    })).resolves.toBe(0);
  });

  it("never falls back to metadata or email for ownership when the customer is unmapped", async () => {
    const event = subscriptionEvent({ customerId: `cus_never_mapped_${randomUUID()}` });
    (event.data.object as Record<string, unknown>).metadata = { userId: "attacker-controlled-id" };
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_CUSTOMER_NOT_MAPPED" });
    await expect(prisma.billingSubscription.count({
      where: { ownerUserId: "attacker-controlled-id" },
    })).resolves.toBe(0);
  });

  it("ignores an out-of-order subscription event and applies an equal-timestamp tie-break", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const subscriptionId = `sub_${randomUUID()}`;
    const sameTime = Math.floor(Date.now() / 1000);

    const newer = subscriptionEvent({
      id: `evt_${randomUUID()}_b`,
      customerId: providerCustomerId,
      subscriptionId,
      status: "active",
      created: sameTime,
    });
    const { rawBody: rawBody1, signatureHeader: sig1 } = signedRequest(newer);
    await processBillingWebhookRequest({ rawBody: rawBody1, signatureHeader: sig1, env: testEnv() });
    webhookEventIds.add(newer.id);

    const stale = subscriptionEvent({
      id: `evt_${randomUUID()}_a`,
      customerId: providerCustomerId,
      subscriptionId,
      status: "past_due",
      created: sameTime - 100,
    });
    const { rawBody: rawBody2, signatureHeader: sig2 } = signedRequest(stale);
    const staleResult = await processBillingWebhookRequest({ rawBody: rawBody2, signatureHeader: sig2, env: testEnv() });
    webhookEventIds.add(stale.id);

    expect(staleResult).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_OUT_OF_ORDER" });
    await expect(
      prisma.billingSubscription.findUnique({
        where: { provider_providerSubscriptionId: { provider: "stripe", providerSubscriptionId: subscriptionId } },
      }),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("returns duplicate for a sequential redelivery of an already-processed event without reprocessing", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const event = subscriptionEvent({ customerId: providerCustomerId });
    const { rawBody, signatureHeader } = signedRequest(event);

    const first = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);
    const second = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });

    expect(first).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_PROCESSED" });
    expect(second).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_DUPLICATE" });
    await expect(prisma.billingWebhookEvent.count({
      where: { provider: "stripe", providerEventId: event.id },
    })).resolves.toBe(1);
  });

  it("returns exactly one processed outcome for concurrent duplicate delivery", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const event = subscriptionEvent({ customerId: providerCustomerId });
    const { rawBody, signatureHeader } = signedRequest(event);

    const [first, second] = await Promise.all([
      processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() }),
      processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() }),
    ]);
    webhookEventIds.add(event.id);

    const codes = [first.code, second.code].sort();
    expect(codes).toEqual(["BILLING_WEBHOOK_EVENT_DUPLICATE", "BILLING_WEBHOOK_EVENT_PROCESSED"]);
    await expect(prisma.billingWebhookEvent.count({
      where: { provider: "stripe", providerEventId: event.id },
    })).resolves.toBe(1);
    await expect(prisma.billingSubscription.count({
      where: { providerSubscriptionId: event.data.object.id },
    })).resolves.toBe(1);
  });

  it("performs zero database interaction while disabled", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const event = subscriptionEvent({ customerId: providerCustomerId });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({
      rawBody,
      signatureHeader,
      env: testEnv({ BILLING_PROCESSING_MODE: "disabled" }),
    });

    expect(result).toEqual({ httpStatus: 503, code: "BILLING_PROCESSING_DISABLED" });
    await expect(prisma.billingWebhookEvent.count({
      where: { provider: "stripe", providerEventId: event.id },
    })).resolves.toBe(0);
  });

  it("restart-safe idempotency: a fresh PrismaClient instance observes the same durable event row", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const event = subscriptionEvent({ customerId: providerCustomerId });
    const { rawBody, signatureHeader } = signedRequest(event);

    await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    const freshClient = new PrismaClient();
    try {
      await expect(
        freshClient.billingWebhookEvent.findUnique({
          where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
        }),
      ).resolves.toMatchObject({ status: "processed" });
    } finally {
      await freshClient.$disconnect();
    }
  });

  it("never persists the raw payload or a signature value in any stored row", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const event = subscriptionEvent({ customerId: providerCustomerId });
    const { rawBody, signatureHeader } = signedRequest(event);

    await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });
    webhookEventIds.add(event.id);

    const row = await prisma.billingWebhookEvent.findUnique({
      where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
    });
    const serializedRow = JSON.stringify(row);
    expect(serializedRow).not.toContain(signatureHeader);
    expect(serializedRow.includes(rawBody)).toBe(false);
    expect(row).not.toHaveProperty("rawBody");
    expect(row).not.toHaveProperty("signature");
    expect(row).not.toHaveProperty("payload");
  });

  it("rolls back the entire sequence when a downstream mutation step fails unexpectedly", async () => {
    const { providerCustomerId } = await createOwnerWithCustomer();
    const event = subscriptionEvent({ customerId: providerCustomerId, status: "not_a_real_stripe_status" as never });
    const { rawBody, signatureHeader } = signedRequest(event);

    const result = await processBillingWebhookRequest({ rawBody, signatureHeader, env: testEnv() });

    expect(result).toEqual({ httpStatus: 200, code: "BILLING_WEBHOOK_EVENT_MALFORMED" });
    await expect(
      prisma.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "stripe", providerEventId: event.id } },
      }),
    ).resolves.toMatchObject({ status: "failed_terminal", lastFailureCode: "BILLING_WEBHOOK_EVENT_MALFORMED" });
    webhookEventIds.add(event.id);
  });
});
