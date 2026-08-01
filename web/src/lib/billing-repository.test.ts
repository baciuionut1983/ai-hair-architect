import { randomUUID } from "crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasRealDatabase = Boolean(process.env.TEST_DATABASE_URL);

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  transaction: vi.fn(),
  billingCustomerFindUnique: vi.fn(),
  billingCustomerCreate: vi.fn(),
  billingSubscriptionFindUnique: vi.fn(),
  billingWebhookEventCreate: vi.fn(),
  billingWebhookEventFindUnique: vi.fn(),
  billingWebhookEventUpdate: vi.fn(),
  billingPaymentUpsert: vi.fn(),
  txBillingSubscriptionFindUnique: vi.fn(),
  txBillingSubscriptionCreate: vi.fn(),
  txBillingSubscriptionUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", async (importOriginal) => {
  if (process.env.TEST_DATABASE_URL) {
    return importOriginal();
  }
  return {
    isDatabaseConfigured: () => prismaMocks.configured,
    prisma: {
      $transaction: prismaMocks.transaction,
      billingCustomer: {
        findUnique: prismaMocks.billingCustomerFindUnique,
        create: prismaMocks.billingCustomerCreate,
      },
      billingSubscription: {
        findUnique: prismaMocks.billingSubscriptionFindUnique,
      },
      billingWebhookEvent: {
        create: prismaMocks.billingWebhookEventCreate,
        findUnique: prismaMocks.billingWebhookEventFindUnique,
        update: prismaMocks.billingWebhookEventUpdate,
      },
      billingPayment: {
        upsert: prismaMocks.billingPaymentUpsert,
      },
    },
  };
});

import {
  BillingCustomerConflictError,
  BillingPersistenceError,
  billingPersistenceUnavailableResponse,
  findOrCreateBillingCustomer,
  findOwnerByProviderCustomerId,
  getBillingCustomerByOwner,
  getSubscriptionByProviderId,
  getWebhookEventByProviderId,
  isBillingPersistenceError,
  markWebhookEventStatus,
  recordWebhookEventIdempotently,
  runBillingWebhookTransaction,
  upsertPayment,
  upsertSubscriptionWithOrderingGuard,
} from "./billing-repository";

const tx = {
  billingSubscription: {
    findUnique: prismaMocks.txBillingSubscriptionFindUnique,
    create: prismaMocks.txBillingSubscriptionCreate,
    update: prismaMocks.txBillingSubscriptionUpdate,
  },
};

const unitSuite = hasRealDatabase ? describe.skip : describe;
const integrationSuite = hasRealDatabase ? describe : describe.skip;

unitSuite("billing-repository (mocked)", () => {
  beforeEach(() => {
    prismaMocks.configured = true;
    prismaMocks.transaction.mockReset();
    prismaMocks.billingCustomerFindUnique.mockReset();
    prismaMocks.billingCustomerCreate.mockReset();
    prismaMocks.billingSubscriptionFindUnique.mockReset();
    prismaMocks.billingWebhookEventCreate.mockReset();
    prismaMocks.billingWebhookEventFindUnique.mockReset();
    prismaMocks.billingWebhookEventUpdate.mockReset();
    prismaMocks.billingPaymentUpsert.mockReset();
    prismaMocks.txBillingSubscriptionFindUnique.mockReset();
    prismaMocks.txBillingSubscriptionCreate.mockReset();
    prismaMocks.txBillingSubscriptionUpdate.mockReset();
    prismaMocks.transaction.mockImplementation(async (operation) => operation(tx));
  });

  describe("findOrCreateBillingCustomer", () => {
    it("creates a new mapping when none exists for the owner", async () => {
      prismaMocks.billingCustomerFindUnique.mockResolvedValueOnce(null);
      prismaMocks.billingCustomerCreate.mockResolvedValueOnce(customerRow());

      await expect(findOrCreateBillingCustomer(customerInput())).resolves.toMatchObject({
        ownerUserId: "owner-1",
        providerCustomerId: "cus_1",
      });
      expect(prismaMocks.billingCustomerCreate).toHaveBeenCalledWith({
        data: { ownerUserId: "owner-1", provider: "stripe", providerCustomerId: "cus_1" },
      });
    });

    it("returns the existing mapping idempotently when the customer id matches", async () => {
      prismaMocks.billingCustomerFindUnique.mockResolvedValueOnce(customerRow());

      await expect(findOrCreateBillingCustomer(customerInput())).resolves.toMatchObject({
        providerCustomerId: "cus_1",
      });
      expect(prismaMocks.billingCustomerCreate).not.toHaveBeenCalled();
    });

    it("rejects an owner already mapped to a different provider customer", async () => {
      prismaMocks.billingCustomerFindUnique.mockResolvedValueOnce(customerRow({ providerCustomerId: "cus_other" }));

      await expect(findOrCreateBillingCustomer(customerInput())).rejects.toBeInstanceOf(
        BillingCustomerConflictError,
      );
      expect(prismaMocks.billingCustomerCreate).not.toHaveBeenCalled();
    });

    it("reconciles a concurrent create race for the same owner and customer id", async () => {
      prismaMocks.billingCustomerFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(customerRow());
      prismaMocks.billingCustomerCreate.mockRejectedValueOnce(uniqueConstraintError());

      await expect(findOrCreateBillingCustomer(customerInput())).resolves.toMatchObject({
        providerCustomerId: "cus_1",
      });
    });

    it("rejects a concurrent create race that resolves to a conflicting mapping", async () => {
      prismaMocks.billingCustomerFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prismaMocks.billingCustomerCreate.mockRejectedValueOnce(uniqueConstraintError());

      await expect(findOrCreateBillingCustomer(customerInput())).rejects.toBeInstanceOf(
        BillingCustomerConflictError,
      );
    });
  });

  describe("findOwnerByProviderCustomerId", () => {
    it("returns the owner mapping when found", async () => {
      prismaMocks.billingCustomerFindUnique.mockResolvedValueOnce({ id: "cust-1", ownerUserId: "owner-1" });

      await expect(findOwnerByProviderCustomerId("stripe", "cus_1")).resolves.toEqual({
        ownerUserId: "owner-1",
        billingCustomerId: "cust-1",
      });
    });

    it("returns null when the provider customer id is unknown", async () => {
      prismaMocks.billingCustomerFindUnique.mockResolvedValueOnce(null);

      await expect(findOwnerByProviderCustomerId("stripe", "cus_unknown")).resolves.toBeNull();
    });
  });

  describe("recordWebhookEventIdempotently", () => {
    it("records a new event", async () => {
      prismaMocks.billingWebhookEventCreate.mockResolvedValueOnce(webhookEventRow());

      await expect(recordWebhookEventIdempotently(webhookEventInput())).resolves.toMatchObject({
        outcome: "recorded",
        event: { providerEventId: "evt_1" },
      });
    });

    it("classifies a concurrent duplicate delivery as duplicate, not a failure", async () => {
      prismaMocks.billingWebhookEventCreate.mockRejectedValueOnce(uniqueConstraintError());
      prismaMocks.billingWebhookEventFindUnique.mockResolvedValueOnce(webhookEventRow());

      await expect(recordWebhookEventIdempotently(webhookEventInput())).resolves.toMatchObject({
        outcome: "duplicate",
        event: { providerEventId: "evt_1" },
      });
    });
  });

  describe("markWebhookEventStatus", () => {
    it("updates only the provided fields", async () => {
      prismaMocks.billingWebhookEventUpdate.mockResolvedValueOnce(webhookEventRow());

      await markWebhookEventStatus("event-1", { status: "processing" });

      expect(prismaMocks.billingWebhookEventUpdate).toHaveBeenCalledWith({
        where: { id: "event-1" },
        data: { status: "processing" },
      });
    });

    it("maps failureCode to lastFailureCode and includes explicit optional fields", async () => {
      prismaMocks.billingWebhookEventUpdate.mockResolvedValueOnce(webhookEventRow());

      await markWebhookEventStatus("event-1", {
        status: "failed_retryable",
        attemptCount: 2,
        failureCode: "card_declined",
        processedAt: null,
        ownerUserId: "owner-1",
      });

      expect(prismaMocks.billingWebhookEventUpdate).toHaveBeenCalledWith({
        where: { id: "event-1" },
        data: {
          status: "failed_retryable",
          attemptCount: 2,
          lastFailureCode: "card_declined",
          processedAt: null,
          ownerUserId: "owner-1",
        },
      });
    });
  });

  describe("upsertSubscriptionWithOrderingGuard", () => {
    it("creates a subscription when none exists", async () => {
      prismaMocks.txBillingSubscriptionFindUnique.mockResolvedValueOnce(null);
      prismaMocks.txBillingSubscriptionCreate.mockResolvedValueOnce(subscriptionRow());

      await expect(upsertSubscriptionWithOrderingGuard(subscriptionInput())).resolves.toMatchObject({
        applied: true,
      });
      expect(prismaMocks.txBillingSubscriptionCreate).toHaveBeenCalledTimes(1);
      expect(prismaMocks.transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });

    it("applies a strictly newer event over an existing subscription", async () => {
      prismaMocks.txBillingSubscriptionFindUnique.mockResolvedValueOnce(subscriptionRow({
        lastAppliedEventCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
        lastAppliedEventId: "evt_1",
      }));
      prismaMocks.txBillingSubscriptionUpdate.mockResolvedValueOnce(subscriptionRow());

      await expect(upsertSubscriptionWithOrderingGuard(subscriptionInput({
        eventCreatedAt: new Date("2026-08-01T01:00:00.000Z"),
        providerEventId: "evt_2",
      }))).resolves.toMatchObject({ applied: true });
      expect(prismaMocks.txBillingSubscriptionUpdate).toHaveBeenCalledTimes(1);
    });

    it("ignores a strictly older event", async () => {
      const existing = subscriptionRow({
        lastAppliedEventCreatedAt: new Date("2026-08-01T02:00:00.000Z"),
        lastAppliedEventId: "evt_5",
      });
      prismaMocks.txBillingSubscriptionFindUnique.mockResolvedValueOnce(existing);

      await expect(upsertSubscriptionWithOrderingGuard(subscriptionInput({
        eventCreatedAt: new Date("2026-08-01T01:00:00.000Z"),
        providerEventId: "evt_2",
      }))).resolves.toEqual({ applied: false, subscription: existing });
      expect(prismaMocks.txBillingSubscriptionUpdate).not.toHaveBeenCalled();
      expect(prismaMocks.txBillingSubscriptionCreate).not.toHaveBeenCalled();
    });

    it("applies an equal-timestamp event only when lexically greater in id", async () => {
      const sameTime = new Date("2026-08-01T02:00:00.000Z");
      const existing = subscriptionRow({ lastAppliedEventCreatedAt: sameTime, lastAppliedEventId: "evt_b" });

      prismaMocks.txBillingSubscriptionFindUnique.mockResolvedValueOnce(existing);
      await expect(upsertSubscriptionWithOrderingGuard(subscriptionInput({
        eventCreatedAt: sameTime,
        providerEventId: "evt_a",
      }))).resolves.toMatchObject({ applied: false });

      prismaMocks.txBillingSubscriptionFindUnique.mockResolvedValueOnce(existing);
      prismaMocks.txBillingSubscriptionUpdate.mockResolvedValueOnce(subscriptionRow());
      await expect(upsertSubscriptionWithOrderingGuard(subscriptionInput({
        eventCreatedAt: sameTime,
        providerEventId: "evt_c",
      }))).resolves.toMatchObject({ applied: true });
    });

    it("retries once on a serialization conflict and then succeeds", async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", {
        code: "P2034",
        clientVersion: "test",
      });
      prismaMocks.transaction
        .mockRejectedValueOnce(conflict)
        .mockImplementationOnce(async (operation) => operation(tx));
      prismaMocks.txBillingSubscriptionFindUnique.mockResolvedValueOnce(null);
      prismaMocks.txBillingSubscriptionCreate.mockResolvedValueOnce(subscriptionRow());

      await expect(upsertSubscriptionWithOrderingGuard(subscriptionInput())).resolves.toMatchObject({
        applied: true,
      });
      expect(prismaMocks.transaction).toHaveBeenCalledTimes(2);
    });

    it("fails closed as a persistence error after exhausting retries", async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError("deadlock", {
        code: "P2034",
        clientVersion: "test",
      });
      prismaMocks.transaction.mockRejectedValue(conflict);

      await expect(upsertSubscriptionWithOrderingGuard(subscriptionInput())).rejects.toBeInstanceOf(
        BillingPersistenceError,
      );
      expect(prismaMocks.transaction).toHaveBeenCalledTimes(3);
    });
  });

  describe("upsertPayment", () => {
    it("upserts keyed by provider and invoice id", async () => {
      prismaMocks.billingPaymentUpsert.mockResolvedValueOnce(paymentRow());

      await expect(upsertPayment(paymentInput())).resolves.toMatchObject({ providerInvoiceId: "in_1" });
      expect(prismaMocks.billingPaymentUpsert).toHaveBeenCalledWith({
        where: { provider_providerInvoiceId: { provider: "stripe", providerInvoiceId: "in_1" } },
        create: expect.objectContaining({ providerInvoiceId: "in_1" }),
        update: expect.objectContaining({ providerInvoiceId: "in_1" }),
      });
    });
  });

  describe("read primitives", () => {
    it("returns rows or null for owner, subscription, and event lookups", async () => {
      prismaMocks.billingCustomerFindUnique.mockResolvedValueOnce(customerRow());
      await expect(getBillingCustomerByOwner("owner-1", "stripe")).resolves.toMatchObject({
        ownerUserId: "owner-1",
      });

      prismaMocks.billingSubscriptionFindUnique.mockResolvedValueOnce(null);
      await expect(getSubscriptionByProviderId("stripe", "sub_1")).resolves.toBeNull();

      prismaMocks.billingWebhookEventFindUnique.mockResolvedValueOnce(webhookEventRow());
      await expect(getWebhookEventByProviderId("stripe", "evt_1")).resolves.toMatchObject({
        providerEventId: "evt_1",
      });
    });
  });

  describe("runBillingWebhookTransaction", () => {
    it("delegates to prisma.$transaction and returns its result", async () => {
      prismaMocks.transaction.mockImplementationOnce(async (operation) => operation("tx-placeholder"));
      const callback = vi.fn().mockResolvedValue("result-value");

      await expect(runBillingWebhookTransaction(callback)).resolves.toBe("result-value");
      expect(callback).toHaveBeenCalledWith("tx-placeholder");
    });
  });

  describe("fail-closed behavior", () => {
    it("rejects with BillingPersistenceError when the database is not configured", async () => {
      prismaMocks.configured = false;

      await expect(getBillingCustomerByOwner("owner-1", "stripe")).rejects.toBeInstanceOf(
        BillingPersistenceError,
      );
      expect(isBillingPersistenceError(new BillingPersistenceError())).toBe(true);
      expect(isBillingPersistenceError(new Error("other"))).toBe(false);

      const response = billingPersistenceUnavailableResponse();
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: "BILLING_PERSISTENCE_UNAVAILABLE",
        message: "Billing data is temporarily unavailable.",
      });
    });

    it("maps unexpected database failures to a controlled persistence error", async () => {
      prismaMocks.billingCustomerFindUnique.mockRejectedValueOnce(new Error("database unavailable"));

      await expect(getBillingCustomerByOwner("owner-1", "stripe")).rejects.toBeInstanceOf(
        BillingPersistenceError,
      );
    });
  });
});

integrationSuite("billing-repository (real Postgres)", () => {
  const owners = new Set<string>();
  const webhookEventIds = new Set<string>();

  afterEach(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.billingWebhookEvent.deleteMany({ where: { id: { in: [...webhookEventIds] } } });
    await prisma.billingPayment.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.billingSubscription.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.billingCustomer.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
    webhookEventIds.clear();
  });

  it("persists a durable owner-to-customer mapping and rejects a conflicting one", async () => {
    const ownerUserId = await createOwner(owners);

    const created = await findOrCreateBillingCustomer({
      ownerUserId,
      provider: "stripe",
      providerCustomerId: `cus_${ownerUserId}`,
    });
    await expect(findOrCreateBillingCustomer({
      ownerUserId,
      provider: "stripe",
      providerCustomerId: `cus_${ownerUserId}`,
    })).resolves.toMatchObject({ id: created.id });

    await expect(findOrCreateBillingCustomer({
      ownerUserId,
      provider: "stripe",
      providerCustomerId: "cus_conflicting",
    })).rejects.toBeInstanceOf(BillingCustomerConflictError);

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.billingCustomer.count({ where: { ownerUserId } })).resolves.toBe(1);
    } finally {
      await freshClient.$disconnect();
    }
  });

  it("rejects a provider customer id already mapped to a different owner", async () => {
    const first = await createOwner(owners);
    const second = await createOwner(owners);
    const sharedProviderCustomerId = `cus_shared_${first}`;

    await findOrCreateBillingCustomer({ ownerUserId: first, provider: "stripe", providerCustomerId: sharedProviderCustomerId });

    await expect(findOrCreateBillingCustomer({
      ownerUserId: second,
      provider: "stripe",
      providerCustomerId: sharedProviderCustomerId,
    })).rejects.toBeInstanceOf(BillingCustomerConflictError);
  });

  it("returns null for an unknown provider customer id and the mapping for a known one", async () => {
    const ownerUserId = await createOwner(owners);
    const providerCustomerId = `cus_${ownerUserId}`;
    await findOrCreateBillingCustomer({ ownerUserId, provider: "stripe", providerCustomerId });

    await expect(findOwnerByProviderCustomerId("stripe", providerCustomerId)).resolves.toMatchObject({
      ownerUserId,
    });
    await expect(findOwnerByProviderCustomerId("stripe", "cus_never_seen")).resolves.toBeNull();
  });

  it("records exactly one durable row and classifies the losing concurrent delivery as duplicate", async () => {
    const ownerUserId = await createOwner(owners);
    const providerEventId = `evt_${randomUUID()}`;
    webhookEventIds.add(providerEventId);

    const input = {
      provider: "stripe" as const,
      providerEventId,
      eventType: "customer.subscription.updated",
      eventCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
      ownerUserId,
    };

    const [first, second] = await Promise.all([
      recordWebhookEventIdempotently(input),
      recordWebhookEventIdempotently(input),
    ]);
    webhookEventIds.add(first.event.id);
    webhookEventIds.add(second.event.id);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["duplicate", "recorded"]);
    expect(first.event.id).toBe(second.event.id);

    const { prisma } = await import("@/lib/prisma");
    await expect(prisma.billingWebhookEvent.count({
      where: { provider: "stripe", providerEventId },
    })).resolves.toBe(1);
  });

  it("transitions event status and records sanitized failure evidence", async () => {
    const ownerUserId = await createOwner(owners);
    const providerEventId = `evt_${randomUUID()}`;

    const { event } = await recordWebhookEventIdempotently({
      provider: "stripe",
      providerEventId,
      eventType: "invoice.payment_failed",
      eventCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
      ownerUserId,
    });
    webhookEventIds.add(event.id);

    await markWebhookEventStatus(event.id, {
      status: "failed_retryable",
      attemptCount: 1,
      failureCode: "card_declined",
    });

    const { prisma } = await import("@/lib/prisma");
    await expect(prisma.billingWebhookEvent.findUnique({ where: { id: event.id } })).resolves.toMatchObject({
      status: "failed_retryable",
      attemptCount: 1,
      lastFailureCode: "card_declined",
    });
  });

  it("ignores an out-of-order event and applies an equal-timestamp tie-break by event id", async () => {
    const ownerUserId = await createOwner(owners);
    const customer = await findOrCreateBillingCustomer({
      ownerUserId,
      provider: "stripe",
      providerCustomerId: `cus_${ownerUserId}`,
    });
    const providerSubscriptionId = `sub_${randomUUID()}`;

    const first = await upsertSubscriptionWithOrderingGuard({
      ownerUserId,
      billingCustomerId: customer.id,
      provider: "stripe",
      providerSubscriptionId,
      planKey: "pro",
      status: "active",
      eventCreatedAt: new Date("2026-08-01T02:00:00.000Z"),
      providerEventId: "evt_b",
    });
    expect(first.applied).toBe(true);

    const stale = await upsertSubscriptionWithOrderingGuard({
      ownerUserId,
      billingCustomerId: customer.id,
      provider: "stripe",
      providerSubscriptionId,
      planKey: "pro",
      status: "past_due",
      eventCreatedAt: new Date("2026-08-01T01:00:00.000Z"),
      providerEventId: "evt_a",
    });
    expect(stale.applied).toBe(false);
    expect(stale.subscription.status).toBe("active");

    const tieLosing = await upsertSubscriptionWithOrderingGuard({
      ownerUserId,
      billingCustomerId: customer.id,
      provider: "stripe",
      providerSubscriptionId,
      planKey: "pro",
      status: "past_due",
      eventCreatedAt: new Date("2026-08-01T02:00:00.000Z"),
      providerEventId: "evt_a",
    });
    expect(tieLosing.applied).toBe(false);

    const tieWinning = await upsertSubscriptionWithOrderingGuard({
      ownerUserId,
      billingCustomerId: customer.id,
      provider: "stripe",
      providerSubscriptionId,
      planKey: "pro",
      status: "canceled",
      eventCreatedAt: new Date("2026-08-01T02:00:00.000Z"),
      providerEventId: "evt_c",
    });
    expect(tieWinning.applied).toBe(true);
    expect(tieWinning.subscription.status).toBe("canceled");
  });

  it("upserts a payment keyed by invoice id and enforces owner isolation across reads", async () => {
    const first = await createOwner(owners);
    const second = await createOwner(owners);
    const providerInvoiceId = `in_${randomUUID()}`;

    const created = await upsertPayment({
      ownerUserId: first,
      provider: "stripe",
      providerInvoiceId,
      amountCents: 1999,
      currency: "usd",
      status: "succeeded",
    });
    const updated = await upsertPayment({
      ownerUserId: first,
      provider: "stripe",
      providerInvoiceId,
      amountCents: 1999,
      currency: "usd",
      status: "refunded",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe("refunded");

    const { prisma } = await import("@/lib/prisma");
    await expect(prisma.billingPayment.count({ where: { ownerUserId: first } })).resolves.toBe(1);
    await expect(prisma.billingPayment.count({ where: { ownerUserId: second } })).resolves.toBe(0);
  });

  it("restart-safe idempotency: a fresh PrismaClient instance observes the same durable event row", async () => {
    const ownerUserId = await createOwner(owners);
    const providerEventId = `evt_${randomUUID()}`;

    const { event } = await recordWebhookEventIdempotently({
      provider: "stripe",
      providerEventId,
      eventType: "customer.subscription.updated",
      eventCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
      ownerUserId,
    });
    webhookEventIds.add(event.id);

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "stripe", providerEventId } },
      })).resolves.toMatchObject({ id: event.id, status: "received" });
    } finally {
      await freshClient.$disconnect();
    }
  });
});

function customerInput() {
  return { ownerUserId: "owner-1", provider: "stripe" as const, providerCustomerId: "cus_1" };
}

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cust-1",
    ownerUserId: "owner-1",
    provider: "stripe",
    providerCustomerId: "cus_1",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function webhookEventInput() {
  return {
    provider: "stripe" as const,
    providerEventId: "evt_1",
    eventType: "customer.subscription.updated",
    eventCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ownerUserId: "owner-1",
  };
}

function webhookEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    provider: "stripe",
    providerEventId: "evt_1",
    eventType: "customer.subscription.updated",
    apiVersion: null,
    status: "received",
    ownerUserId: "owner-1",
    providerCustomerId: null,
    providerSubscriptionId: null,
    providerInvoiceId: null,
    eventCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
    receivedAt: new Date("2026-08-01T00:00:00.000Z"),
    lastAttemptedAt: null,
    processedAt: null,
    attemptCount: 0,
    lastFailureCode: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function subscriptionInput(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: "owner-1",
    billingCustomerId: "cust-1",
    provider: "stripe" as const,
    providerSubscriptionId: "sub-1",
    planKey: "pro",
    status: "active" as const,
    eventCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
    providerEventId: "evt_1",
    ...overrides,
  };
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-row-1",
    ownerUserId: "owner-1",
    billingCustomerId: "cust-1",
    provider: "stripe",
    providerSubscriptionId: "sub-1",
    planKey: "pro",
    status: "active",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    lastAppliedEventCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
    lastAppliedEventId: "evt_1",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function paymentInput() {
  return {
    ownerUserId: "owner-1",
    provider: "stripe" as const,
    providerInvoiceId: "in_1",
    amountCents: 1999,
    currency: "usd",
    status: "succeeded" as const,
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    ownerUserId: "owner-1",
    billingSubscriptionId: null,
    provider: "stripe",
    providerInvoiceId: "in_1",
    providerPaymentIntentId: null,
    amountCents: 1999,
    currency: "usd",
    status: "succeeded",
    paidAt: null,
    failedAt: null,
    failureCode: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("unique constraint", {
    code: "P2002",
    clientVersion: "test",
  });
}

async function createOwner(owners: Set<string>): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@billing.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  return ownerUserId;
}
