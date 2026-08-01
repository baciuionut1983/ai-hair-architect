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
  "billingCustomer" | "billingSubscription" | "billingPayment" | "billingWebhookEvent"
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
): Promise<BillingCustomerRow> {
  return runBillingQuery(async () => {
    const existingByOwner = await prisma.billingCustomer.findUnique({
      where: { ownerUserId_provider: { ownerUserId: input.ownerUserId, provider: input.provider } },
    });
    if (existingByOwner) {
      if (existingByOwner.providerCustomerId !== input.providerCustomerId) {
        throw new BillingCustomerConflictError();
      }
      return existingByOwner;
    }

    try {
      return await prisma.billingCustomer.create({
        data: {
          ownerUserId: input.ownerUserId,
          provider: input.provider,
          providerCustomerId: input.providerCustomerId,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;

      const reconciled = await prisma.billingCustomer.findUnique({
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
): Promise<{ ownerUserId: string; billingCustomerId: string } | null> {
  return runBillingQuery(async () => {
    const row = await prisma.billingCustomer.findUnique({
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
): Promise<{ outcome: "recorded" | "duplicate"; event: BillingWebhookEventRow }> {
  return runBillingQuery(async () => {
    try {
      const created = await prisma.billingWebhookEvent.create({
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

      const existing = await prisma.billingWebhookEvent.findUnique({
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
): Promise<void> {
  return runBillingQuery(async () => {
    await prisma.billingWebhookEvent.update({
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
): Promise<{ applied: boolean; subscription: BillingSubscriptionRow }> {
  return runBillingQuery(() => runSerializableBillingTransaction(async (tx) => {
    const existing = await tx.billingSubscription.findUnique({
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
      ? await tx.billingSubscription.update({ where: { id: existing.id }, data })
      : await tx.billingSubscription.create({ data });

    return { applied: true, subscription: upserted };
  }));
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

export async function upsertPayment(input: UpsertPaymentInput): Promise<BillingPaymentRow> {
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
    return prisma.billingPayment.upsert({
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

export async function getWebhookEventByProviderId(
  provider: BillingProvider,
  providerEventId: string,
): Promise<BillingWebhookEventRow | null> {
  return runBillingQuery(() => prisma.billingWebhookEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId } },
  }));
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
