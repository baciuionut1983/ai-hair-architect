const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailSendInput {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSendResult {
  providerMessageId: string;
}

export interface EmailProvider {
  send(input: EmailSendInput, signal: AbortSignal): Promise<EmailSendResult>;
}

/**
 * Thrown whenever the provider call did not throw but also did not return a
 * real, non-empty message id. A caller must never interpret "no exception"
 * as "sent" -- only a genuine id counts as delivery evidence.
 */
export class EmailProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailProviderResponseError";
  }
}

// Distinct, typed error classes instead of string-matching a message later
// -- classifying a failure by inspecting error text would be fragile and
// is exactly the kind of inference this codebase avoids elsewhere.
export class EmailProviderAuthError extends Error {
  constructor(status: number) {
    super(`Resend request failed authentication with status ${status}`);
    this.name = "EmailProviderAuthError";
  }
}

export class EmailProviderRequestError extends Error {
  constructor(status: number) {
    super(`Resend request failed with status ${status}`);
    this.name = "EmailProviderRequestError";
  }
}

export function createResendEmailProvider(apiKey: string, fromAddress: string): EmailProvider {
  return {
    async send(input: EmailSendInput, signal: AbortSignal): Promise<EmailSendResult> {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: input.to,
          subject: input.subject,
          text: input.text,
        }),
        signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new EmailProviderAuthError(response.status);
        }
        throw new EmailProviderRequestError(response.status);
      }

      const data = (await response.json()) as { id?: unknown };
      const providerMessageId = typeof data.id === "string" ? data.id.trim() : "";
      if (!providerMessageId) {
        throw new EmailProviderResponseError("Resend response did not include a real message id.");
      }

      return { providerMessageId };
    },
  };
}
