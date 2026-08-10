import type { EmailCategory, EmailDeliveryStatus } from "@prisma/client";

import { resolveEmailConfig } from "@/lib/email-provider-config";
import {
  EmailProviderAuthError,
  EmailProviderResponseError,
  createResendEmailProvider,
} from "@/lib/email-provider";
import {
  createPendingEmailNotification,
  markEmailNotificationFailed,
  markEmailNotificationSent,
  markEmailNotificationSkipped,
} from "@/lib/email-repository";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendTransactionalEmailInput {
  ownerUserId: string;
  category: EmailCategory;
  eventType: string;
  recipientEmail: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export type SendTransactionalEmailOutcome =
  | { status: "sent"; notificationId: string; providerMessageId: string }
  | { status: "failed"; notificationId: string; failureCode: string }
  | { status: "skipped"; notificationId: string }
  | { status: "already_queued"; notificationId: string; existingStatus: EmailDeliveryStatus }
  | { status: "persistence_unavailable" };

/**
 * The sole entry point for sending an operational/transactional email.
 * Deliberately never throws -- a caller (register, the reminder flow, the
 * billing webhook processor) must never fail or be delayed by an email
 * problem. Every code path resolves the persisted row out of "pending"
 * before returning, except the one genuinely unrecoverable case (the
 * database becomes unreachable between creating the row and updating it),
 * which is a disclosed residual risk, not something this function can
 * paper over.
 */
export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
): Promise<SendTransactionalEmailOutcome> {
  let created;
  try {
    created = await createPendingEmailNotification({
      ownerUserId: input.ownerUserId,
      category: input.category,
      eventType: input.eventType,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      idempotencyKey: input.idempotencyKey,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
    });
  } catch {
    // createPendingEmailNotification only ever throws EmailPersistenceError
    // (its own runEmailQuery wraps every failure), so there is nothing more
    // specific to branch on here -- the intent could not even be recorded.
    return { status: "persistence_unavailable" };
  }

  const notificationId = created.notification.id;

  if (!created.created) {
    // An email for this exact event was already queued/handled -- never
    // attempt a second delivery for the same idempotencyKey.
    return { status: "already_queued", notificationId, existingStatus: created.notification.status };
  }

  if (!EMAIL_PATTERN.test(input.recipientEmail)) {
    await safeMarkFailed(notificationId, "EMAIL_RECIPIENT_INVALID");
    return { status: "failed", notificationId, failureCode: "EMAIL_RECIPIENT_INVALID" };
  }

  const config = resolveEmailConfig();
  if (config.status !== "enabled") {
    await safeMarkSkipped(notificationId);
    return { status: "skipped", notificationId };
  }

  const provider = createResendEmailProvider(config.apiKey, config.fromAddress);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const result = await provider.send(
      { to: input.recipientEmail, subject: input.subject, text: input.text, html: input.html },
      controller.signal,
    );
    await safeMarkSent(notificationId, result.providerMessageId);
    return { status: "sent", notificationId, providerMessageId: result.providerMessageId };
  } catch (error) {
    const failureCode = classifyFailure(error, controller.signal.aborted);
    await safeMarkFailed(notificationId, failureCode, safeFailureMessage(error));
    return { status: "failed", notificationId, failureCode };
  } finally {
    clearTimeout(timer);
  }
}

function classifyFailure(error: unknown, aborted: boolean): string {
  if (aborted) return "EMAIL_PROVIDER_TIMEOUT";
  if (error instanceof EmailProviderResponseError) return "EMAIL_PROVIDER_INVALID_RESPONSE";
  if (error instanceof EmailProviderAuthError) return "EMAIL_PROVIDER_AUTH_FAILED";
  return "EMAIL_PROVIDER_ERROR";
}

function safeFailureMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.slice(0, 200);
}

async function safeMarkSent(id: string, providerMessageId: string): Promise<void> {
  try {
    await markEmailNotificationSent(id, providerMessageId);
  } catch {
    // Persisting the outcome failed (e.g. database became unreachable
    // between creating the row and updating it) -- the email was still
    // genuinely sent, and the function's return value already reflects
    // that to the caller. The stored row staying stale here is a disclosed
    // residual risk, not swallowed silently at the API surface.
  }
}

async function safeMarkFailed(id: string, failureCode: string, failureMessageSafe?: string): Promise<void> {
  try {
    await markEmailNotificationFailed(id, failureCode, failureMessageSafe);
  } catch {
    // See safeMarkSent.
  }
}

async function safeMarkSkipped(id: string): Promise<void> {
  try {
    await markEmailNotificationSkipped(id);
  } catch {
    // See safeMarkSent.
  }
}
