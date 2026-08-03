import { randomUUID } from "crypto";

import {
  Prisma,
  type BillingCustomer as PrismaBillingCustomerRow,
  type BillingPayment as PrismaBillingPaymentRow,
  type BillingProvider,
  type BillingPaymentStatus,
  type BillingSubscription as PrismaBillingSubscriptionRow,
  type BillingSubscriptionStatus,
  type BillingWebhookEvent as PrismaBillingWebhookEventRow,
  type BillingWebhookEventStatus,
} from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const BILLING_PERSISTENCE_ERROR_CODE = "BILLING_PERSISTENCE_UNAVAILABLE";
export const BILLING_CUSTOMER_CONFLICT_ERROR_CODE = "BILLING_CUSTOMER_MAPPING_CONFLICT";

const MAX_SUBSCRIPTION_TRANSACTION_ATTEMPTS = 3;

export type BillingCustomerRow = PrismaBillingCustomerRow;
export type BillingSubscriptionRow = PrismaBillingSubscriptionRow;
export type BillingPaymentRow = PrismaBillingPaymentRow;
export type BillingWebhookEventRow = PrismaBillingWebhookEventRow;

export type BillingTransaction = Pick<
  Prisma.TransactionClient,
  "billingCustomer" | "billingSubscription" | "billingPayment" | "billingWebhookEvent" | "$executeRaw"
>;

export class BillingPersistenceError extends Error {
  readonly code = BILLING_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Billing data is temporarily unavailable.");
    this.name = "BillingPersistenceError";
  }
}

export class BillingCustomerConflictError extends Error {
  readonly code = BILLING_CUSTOMER_CONFLICT_ERROR_CODE;
  readonly httpStatus = 409;

  constructor() {
    super("Billing customer mapping conflicts with an existing record.");
    this.name = "BillingCustomerConflictError";
  }
}

export interface FindOrCreateBillingCustomerInput {
  ownerUserId: string;
  provider: BillingProvider;
  providerCustomerId: string;
}

export async function findOrCreateBillingCustomer(
  input: FindOrCreateBillingCustomerInput,
  db: BillingTransaction = prisma,
): Promise<BillingCustomerRow> {
  return runBillingQuery(async () => {
    const existingByOwner = await db.billingCustomer.findUnique({
      where: { ownerUserId_provider: { ownerUserId: input.ownerUserId, provider: input.provider } },
    });
    if (existingByOwner) {
      if (existingByOwner.providerCustomerId !== input.providerCustomerId) {
        throw new BillingCustomerConflictError();
      }
      return existingByOwner;
    }

    const insideTransaction = db !== prisma;
    if (insideTransaction) await db.$executeRaw`SAVEPOINT find_or_create_billing_customer`;

    try {
      return await db.billingCustomer.create({
        data: {
          ownerUserId: input.ownerUserId,
          provider: input.provider,
          providerCustomerId: input.providerCustomerId,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;

      if (insideTransaction) await db.$executeRaw`ROLLBACK TO SAVEPOINT find_or_create_billing_customer`;

      const reconciled = await db.billingCustomer.findUnique({
        where: { ownerUserId_provider: { ownerUserId: input.ownerUserId, provider: input.provider } },
      });
      if (reconciled && reconciled.providerCustomerId === input.providerCustomerId) {
        return reconciled;
      }
      throw new BillingCustomerConflictError();
    }
  });
}

export async function findOwnerByProviderCustomerId(
  provider: BillingProvider,
  providerCustomerId: string,
  db: BillingTransaction = prisma,
): Promise<{ ownerUserId: string; billingCustomerId: string } | null> {
  return runBillingQuery(async () => {
    const row = await db.billingCustomer.findUnique({
      where: { provider_providerCustomerId: { provider, providerCustomerId } },
      select: { id: true, ownerUserId: true },
    });
    return row ? { ownerUserId: row.ownerUserId, billingCustomerId: row.id } : null;
  });
}

export interface RecordWebhookEventInput {
  provider: BillingProvider;
  providerEventId: string;
  eventType: string;
  apiVersion?: string | null;
  eventCreatedAt: Date;
  ownerUserId?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerInvoiceId?: string | null;
}

export async function recordWebhookEventIdempotently(
  input: RecordWebhookEventInput,
  db: BillingTransaction = prisma,
): Promise<{ outcome: "recorded" | "duplicate"; event: BillingWebhookEventRow }> {
  return runBillingQuery(async () => {
    const insideTransaction = db !== prisma;
    if (insideTransaction) await db.$executeRaw`SAVEPOINT record_webhook_event`;

    try {
      const created = await db.billingWebhookEvent.create({
        data: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          apiVersion: input.apiVersion ?? null,
          eventCreatedAt: input.eventCreatedAt,
          ownerUserId: input.ownerUserId ?? null,
          providerCustomerId: input.providerCustomerId ?? null,
          providerSubscriptionId: input.providerSubscriptionId ?? null,
          providerInvoiceId: input.providerInvoiceId ?? null,
        },
      });
      return { outcome: "recorded", event: created };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;

      if (insideTransaction) await db.$executeRaw`ROLLBACK TO SAVEPOINT record_webhook_event`;

      const existing = await db.billingWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: input.provider, providerEventId: input.providerEventId } },
      });
      if (!existing) throw error;
      return { outcome: "duplicate", event: existing };
    }
  });
}

export interface MarkWebhookEventStatusInput {
  status: BillingWebhookEventStatus;
  attemptCount?: number;
  failureCode?: string | null;
  processedAt?: Date | null;
  ownerUserId?: string | null;
}

export async function markWebhookEventStatus(
  id: string,
  input: MarkWebhookEventStatusInput,
  db: BillingTransaction = prisma,
): Promise<void> {
  return runBillingQuery(async () => {
    await db.billingWebhookEvent.update({
      where: { id },
      data: {
        status: input.status,
        ...(input.attemptCount !== undefined ? { attemptCount: input.attemptCount } : {}),
        ...(input.failureCode !== undefined ? { lastFailureCode: input.failureCode } : {}),
        ...(input.processedAt !== undefined ? { processedAt: input.processedAt } : {}),
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      },
    });
  });
}

export interface UpsertSubscriptionInput {
  ownerUserId: string;
  billingCustomerId: string;
  provider: BillingProvider;
  providerSubscriptionId: string;
  planKey: string;
  status: BillingSubscriptionStatus;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  eventCreatedAt: Date;
  providerEventId: string;
}

export async function upsertSubscriptionWithOrderingGuard(
  input: UpsertSubscriptionInput,
  tx?: BillingTransaction,
): Promise<{ applied: boolean; subscription: BillingSubscriptionRow }> {
  if (tx) {
    return runBillingQuery(() => applySubscriptionOrderingGuardAtomically(tx, input));
  }

  return runBillingQuery(() => runSerializableBillingTransaction(async (standaloneTx) => {
    const existing = await standaloneTx.billingSubscription.findUnique({
      where: {
        provider_providerSubscriptionId: {
          provider: input.provider,
          providerSubscriptionId: input.providerSubscriptionId,
        },
      },
    });

    if (existing && !isNewerSubscriptionEvent(input, existing)) {
      return { applied: false, subscription: existing };
    }

    const data = buildSubscriptionData(input);
    const upserted = existing
      ? await standaloneTx.billingSubscription.update({ where: { id: existing.id }, data })
      : await standaloneTx.billingSubscription.create({ data });

    return { applied: true, subscription: upserted };
  }));
}

async function applySubscriptionOrderingGuardAtomically(
  tx: BillingTransaction,
  input: UpsertSubscriptionInput,
): Promise<{ applied: boolean; subscription: BillingSubscriptionRow }> {
  const data = buildSubscriptionData(input);

  await tx.$executeRaw`SAVEPOINT upsert_subscription_ordering_guard`;
  try {
    const created = await tx.billingSubscription.create({ data });
    return { applied: true, subscription: created };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT upsert_subscription_ordering_guard`;
  }

  const claimed = await tx.billingSubscription.updateMany({
    where: {
      provider: input.provider,
      providerSubscriptionId: input.providerSubscriptionId,
      OR: [
        { lastAppliedEventCreatedAt: null },
        { lastAppliedEventCreatedAt: { lt: input.eventCreatedAt } },
        {
          lastAppliedEventCreatedAt: input.eventCreatedAt,
          lastAppliedEventId: { lt: input.providerEventId },
        },
      ],
    },
    data,
  });

  const current = await tx.billingSubscription.findUniqueOrThrow({
    where: {
      provider_providerSubscriptionId: {
        provider: input.provider,
        providerSubscriptionId: input.providerSubscriptionId,
      },
    },
  });
  return { applied: claimed.count === 1, subscription: current };
}

export interface UpsertPaymentInput {
  ownerUserId: string;
  billingSubscriptionId?: string | null;
  provider: BillingProvider;
  providerInvoiceId: string;
  providerPaymentIntentId?: string | null;
  amountCents: number;
  currency: string;
  status: BillingPaymentStatus;
  paidAt?: Date | null;
  failedAt?: Date | null;
  failureCode?: string | null;
}

export async function upsertPayment(
  input: UpsertPaymentInput,
  db: BillingTransaction = prisma,
): Promise<BillingPaymentRow> {
  return runBillingQuery(async () => {
    const data = {
      ownerUserId: input.ownerUserId,
      billingSubscriptionId: input.billingSubscriptionId ?? null,
      provider: input.provider,
      providerInvoiceId: input.providerInvoiceId,
      providerPaymentIntentId: input.providerPaymentIntentId ?? null,
      amountCents: input.amountCents,
      currency: input.currency,
      status: input.status,
      paidAt: input.paidAt ?? null,
      failedAt: input.failedAt ?? null,
      failureCode: input.failureCode ?? null,
    };
    return db.billingPayment.upsert({
      where: {
        provider_providerInvoiceId: { provider: input.provider, providerInvoiceId: input.providerInvoiceId },
      },
      create: data,
      update: data,
    });
  });
}

export async function getBillingCustomerByOwner(
  ownerUserId: string,
  provider: BillingProvider,
): Promise<BillingCustomerRow | null> {
  return runBillingQuery(() => prisma.billingCustomer.findUnique({
    where: { ownerUserId_provider: { ownerUserId, provider } },
  }));
}

export async function getSubscriptionByProviderId(
  provider: BillingProvider,
  providerSubscriptionId: string,
): Promise<BillingSubscriptionRow | null> {
  return runBillingQuery(() => prisma.billingSubscription.findUnique({
    where: { provider_providerSubscriptionId: { provider, providerSubscriptionId } },
  }));
}

export async function getSubscriptionByOwner(
  ownerUserId: string,
  provider: BillingProvider,
): Promise<BillingSubscriptionRow | null> {
  return runBillingQuery(() => prisma.billingSubscription.findFirst({
    where: { ownerUserId, provider },
    orderBy: { updatedAt: "desc" },
  }));
}

export async function getWebhookEventByProviderId(
  provider: BillingProvider,
  providerEventId: string,
): Promise<BillingWebhookEventRow | null> {
  return runBillingQuery(() => prisma.billingWebhookEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId } },
  }));
}

export type BillingRepositoryHealthCode =
  | "BILLING_READINESS_DATABASE_UNAVAILABLE"
  | "BILLING_READINESS_CUSTOMER_TABLE_UNAVAILABLE"
  | "BILLING_READINESS_SUBSCRIPTION_TABLE_UNAVAILABLE"
  | "BILLING_READINESS_PAYMENT_TABLE_UNAVAILABLE"
  | "BILLING_READINESS_EVENT_TABLE_UNAVAILABLE"
  | "BILLING_READINESS_IDEMPOTENCY_PROBE_FAILED"
  | "BILLING_READINESS_CUSTOMER_MAPPING_PROBE_FAILED"
  | "BILLING_READINESS_INTERNAL_ERROR"
  | "BILLING_READINESS_SUCCEEDED";

export interface BillingRepositoryHealthResult {
  readonly ok: boolean;
  readonly code: BillingRepositoryHealthCode;
}

type ReadinessProbeTable = "customer" | "subscription" | "payment" | "webhookEvent";

const READINESS_PROBE_TABLE_CODE: Record<ReadinessProbeTable, BillingRepositoryHealthCode> = {
  customer: "BILLING_READINESS_CUSTOMER_TABLE_UNAVAILABLE",
  subscription: "BILLING_READINESS_SUBSCRIPTION_TABLE_UNAVAILABLE",
  payment: "BILLING_READINESS_PAYMENT_TABLE_UNAVAILABLE",
  webhookEvent: "BILLING_READINESS_EVENT_TABLE_UNAVAILABLE",
};

class ReadinessProbeTableUnavailable extends Error {
  constructor(readonly table: ReadinessProbeTable) {
    super("readiness probe table unavailable");
  }
}

interface ReadinessProbeOutcome {
  readonly idempotencyProven: boolean;
  readonly customerMappingProven: boolean;
}

class ReadinessProbeRollback {
  constructor(readonly outcome: ReadinessProbeOutcome) {}
}

/**
 * Reserved, database-only readiness probe for M17 GO-4. Runs entirely inside
 * one transaction and always rolls back via a function-local sentinel -- no
 * row from this probe is ever durably persisted, no Stripe API is called, and
 * no real customer/subscription/payment data is touched. Not intended for use
 * outside the billing-readiness gate.
 */
export async function checkBillingRepositoryHealth(): Promise<BillingRepositoryHealthResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, code: "BILLING_READINESS_DATABASE_UNAVAILABLE" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.billingCustomer.count().catch(() => {
        throw new ReadinessProbeTableUnavailable("customer");
      });
      await tx.billingSubscription.count().catch(() => {
        throw new ReadinessProbeTableUnavailable("subscription");
      });
      await tx.billingPayment.count().catch(() => {
        throw new ReadinessProbeTableUnavailable("payment");
      });
      await tx.billingWebhookEvent.count().catch(() => {
        throw new ReadinessProbeTableUnavailable("webhookEvent");
      });

      const probeIdentifier = `internal-readiness-probe:${randomUUID()}`;
      const mapping = await findOwnerByProviderCustomerId("stripe", probeIdentifier, tx);

      const first = await recordWebhookEventIdempotently({
        provider: "stripe",
        providerEventId: probeIdentifier,
        eventType: "internal.readiness_probe",
        eventCreatedAt: new Date(0),
      }, tx);
      const second = await recordWebhookEventIdempotently({
        provider: "stripe",
        providerEventId: probeIdentifier,
        eventType: "internal.readiness_probe",
        eventCreatedAt: new Date(0),
      }, tx);

      throw new ReadinessProbeRollback({
        idempotencyProven: first.outcome === "recorded" && second.outcome === "duplicate",
        customerMappingProven: mapping === null,
      });
    });

    return { ok: false, code: "BILLING_READINESS_INTERNAL_ERROR" };
  } catch (error) {
    if (error instanceof ReadinessProbeRollback) {
      if (!error.outcome.idempotencyProven) {
        return { ok: false, code: "BILLING_READINESS_IDEMPOTENCY_PROBE_FAILED" };
      }
      if (!error.outcome.customerMappingProven) {
        return { ok: false, code: "BILLING_READINESS_CUSTOMER_MAPPING_PROBE_FAILED" };
      }
      return { ok: true, code: "BILLING_READINESS_SUCCEEDED" };
    }
    if (error instanceof ReadinessProbeTableUnavailable) {
      return { ok: false, code: READINESS_PROBE_TABLE_CODE[error.table] };
    }
    return { ok: false, code: "BILLING_READINESS_DATABASE_UNAVAILABLE" };
  }
}

export async function runBillingWebhookTransaction<T>(
  callback: (tx: BillingTransaction) => Promise<T>,
): Promise<T> {
  return runBillingQuery(() => prisma.$transaction(callback));
}

export function isBillingPersistenceError(error: unknown): error is BillingPersistenceError {
  return error instanceof BillingPersistenceError;
}

export function billingPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: BILLING_PERSISTENCE_ERROR_CODE, message: "Billing data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function buildSubscriptionData(input: UpsertSubscriptionInput) {
  return {
    ownerUserId: input.ownerUserId,
    billingCustomerId: input.billingCustomerId,
    provider: input.provider,
    providerSubscriptionId: input.providerSubscriptionId,
    planKey: input.planKey,
    status: input.status,
    currentPeriodStart: input.currentPeriodStart ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    canceledAt: input.canceledAt ?? null,
    lastAppliedEventCreatedAt: input.eventCreatedAt,
    lastAppliedEventId: input.providerEventId,
  };
}

function isNewerSubscriptionEvent(
  incoming: { eventCreatedAt: Date; providerEventId: string },
  existing: { lastAppliedEventCreatedAt: Date | null; lastAppliedEventId: string | null },
): boolean {
  if (existing.lastAppliedEventCreatedAt === null || existing.lastAppliedEventId === null) return true;

  const incomingTime = incoming.eventCreatedAt.getTime();
  const existingTime = existing.lastAppliedEventCreatedAt.getTime();
  if (incomingTime > existingTime) return true;
  if (incomingTime < existingTime) return false;
  return incoming.providerEventId > existing.lastAppliedEventId;
}

async function runBillingQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new BillingPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof BillingPersistenceError || error instanceof BillingCustomerConflictError) {
      throw error;
    }
    throw new BillingPersistenceError();
  }
}

async function runSerializableBillingTransaction<T>(
  operation: (tx: BillingTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SUBSCRIPTION_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConcurrencyError(error) || attempt === MAX_SUBSCRIPTION_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new BillingPersistenceError();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2034";
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}
