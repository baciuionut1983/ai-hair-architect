import { beforeEach, describe, expect, it, vi } from "vitest";

const configMock = vi.hoisted(() => ({ resolveEmailConfig: vi.fn() }));
vi.mock("@/lib/email-provider-config", () => configMock);

const providerMock = vi.hoisted(() => ({
  createResendEmailProvider: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/email-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email-provider")>();
  return {
    ...actual,
    createResendEmailProvider: providerMock.createResendEmailProvider,
  };
});

const repositoryMock = vi.hoisted(() => ({
  createPendingEmailNotification: vi.fn(),
  markEmailNotificationSent: vi.fn(),
  markEmailNotificationFailed: vi.fn(),
  markEmailNotificationSkipped: vi.fn(),
}));
vi.mock("@/lib/email-repository", () => repositoryMock);

import { EmailProviderAuthError, EmailProviderResponseError } from "./email-provider";
import { sendTransactionalEmail } from "./email-service";

const INPUT = {
  ownerUserId: "owner-1",
  category: "onboarding" as const,
  eventType: "user.registered",
  recipientEmail: "user@example.com",
  subject: "Welcome",
  text: "Hi there",
  idempotencyKey: "onboarding.welcome:owner-1",
};

function pendingRow(overrides: Record<string, unknown> = {}) {
  return { id: "email-1", status: "pending", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  repositoryMock.createPendingEmailNotification.mockResolvedValue({ created: true, notification: pendingRow() });
  repositoryMock.markEmailNotificationSent.mockResolvedValue(undefined);
  repositoryMock.markEmailNotificationFailed.mockResolvedValue(undefined);
  repositoryMock.markEmailNotificationSkipped.mockResolvedValue(undefined);
  providerMock.send.mockReset();
  providerMock.createResendEmailProvider.mockReturnValue({ send: providerMock.send });
});

describe("sendTransactionalEmail", () => {
  it("never throws when the intent cannot even be persisted", async () => {
    repositoryMock.createPendingEmailNotification.mockRejectedValue(new Error("db down"));

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "persistence_unavailable" });
  });

  it("returns already_queued and never calls the provider when the idempotencyKey already exists", async () => {
    repositoryMock.createPendingEmailNotification.mockResolvedValue({
      created: false,
      notification: pendingRow({ status: "sent" }),
    });

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "already_queued", notificationId: "email-1", existingStatus: "sent" });
    expect(configMock.resolveEmailConfig).not.toHaveBeenCalled();
    expect(providerMock.send).not.toHaveBeenCalled();
  });

  it("marks failed and never calls the provider for an invalid recipient address", async () => {
    const outcome = await sendTransactionalEmail({ ...INPUT, recipientEmail: "not-an-email" });

    expect(outcome).toEqual({ status: "failed", notificationId: "email-1", failureCode: "EMAIL_RECIPIENT_INVALID" });
    expect(repositoryMock.markEmailNotificationFailed).toHaveBeenCalledWith("email-1", "EMAIL_RECIPIENT_INVALID", undefined);
    expect(configMock.resolveEmailConfig).not.toHaveBeenCalled();
    expect(providerMock.send).not.toHaveBeenCalled();
  });

  it("skips and never calls the provider when the config is disabled", async () => {
    configMock.resolveEmailConfig.mockReturnValue({ status: "disabled" });

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "skipped", notificationId: "email-1" });
    expect(repositoryMock.markEmailNotificationSkipped).toHaveBeenCalledWith("email-1");
    expect(providerMock.send).not.toHaveBeenCalled();
  });

  it("skips and never calls the provider when the config is invalid (misconfigured)", async () => {
    configMock.resolveEmailConfig.mockReturnValue({ status: "invalid", issues: [] });

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "skipped", notificationId: "email-1" });
    expect(providerMock.send).not.toHaveBeenCalled();
  });

  it("marks sent with the real provider message id on success", async () => {
    configMock.resolveEmailConfig.mockReturnValue({
      status: "enabled",
      apiKey: "re_key",
      fromAddress: "noreply@example.com",
      timeoutMs: 8000,
    });
    providerMock.send.mockResolvedValue({ providerMessageId: "re_real_id" });

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "sent", notificationId: "email-1", providerMessageId: "re_real_id" });
    expect(repositoryMock.markEmailNotificationSent).toHaveBeenCalledWith("email-1", "re_real_id");
  });

  it("never marks sent when the provider throws EmailProviderResponseError (no real id)", async () => {
    configMock.resolveEmailConfig.mockReturnValue({
      status: "enabled",
      apiKey: "re_key",
      fromAddress: "noreply@example.com",
      timeoutMs: 8000,
    });
    providerMock.send.mockRejectedValue(new EmailProviderResponseError("no id"));

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "failed", notificationId: "email-1", failureCode: "EMAIL_PROVIDER_INVALID_RESPONSE" });
    expect(repositoryMock.markEmailNotificationSent).not.toHaveBeenCalled();
  });

  it("classifies an auth error distinctly", async () => {
    configMock.resolveEmailConfig.mockReturnValue({
      status: "enabled",
      apiKey: "bad_key",
      fromAddress: "noreply@example.com",
      timeoutMs: 8000,
    });
    providerMock.send.mockRejectedValue(new EmailProviderAuthError(401));

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "failed", notificationId: "email-1", failureCode: "EMAIL_PROVIDER_AUTH_FAILED" });
  });

  it("classifies a generic provider error", async () => {
    configMock.resolveEmailConfig.mockReturnValue({
      status: "enabled",
      apiKey: "re_key",
      fromAddress: "noreply@example.com",
      timeoutMs: 8000,
    });
    providerMock.send.mockRejectedValue(new Error("network blip"));

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "failed", notificationId: "email-1", failureCode: "EMAIL_PROVIDER_ERROR" });
  });

  it("classifies a timeout (abort) distinctly from a generic error", async () => {
    configMock.resolveEmailConfig.mockReturnValue({
      status: "enabled",
      apiKey: "re_key",
      fromAddress: "noreply@example.com",
      timeoutMs: 10,
    });
    providerMock.send.mockImplementation((_input: unknown, signal: AbortSignal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "failed", notificationId: "email-1", failureCode: "EMAIL_PROVIDER_TIMEOUT" });
  });

  it("never throws even if marking the final status in the repository itself fails", async () => {
    configMock.resolveEmailConfig.mockReturnValue({
      status: "enabled",
      apiKey: "re_key",
      fromAddress: "noreply@example.com",
      timeoutMs: 8000,
    });
    providerMock.send.mockResolvedValue({ providerMessageId: "re_real_id" });
    repositoryMock.markEmailNotificationSent.mockRejectedValue(new Error("db down mid-flow"));

    const outcome = await sendTransactionalEmail(INPUT);

    expect(outcome).toEqual({ status: "sent", notificationId: "email-1", providerMessageId: "re_real_id" });
  });

  it("passes html through to the provider when the caller supplies it", async () => {
    configMock.resolveEmailConfig.mockReturnValue({
      status: "enabled",
      apiKey: "re_key",
      fromAddress: "noreply@example.com",
      timeoutMs: 8000,
    });
    providerMock.send.mockResolvedValue({ providerMessageId: "re_real_id" });

    await sendTransactionalEmail({ ...INPUT, html: "<p>Hi there</p>" });

    expect(providerMock.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Hi there", html: "<p>Hi there</p>" }),
      expect.anything(),
    );
  });

  it("passes the exact category, eventType, recipient, subject, and idempotencyKey through to the repository", async () => {
    await sendTransactionalEmail(INPUT);

    expect(repositoryMock.createPendingEmailNotification).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      category: "onboarding",
      eventType: "user.registered",
      recipientEmail: "user@example.com",
      subject: "Welcome",
      idempotencyKey: "onboarding.welcome:owner-1",
      relatedEntityType: undefined,
      relatedEntityId: undefined,
    });
  });
});
