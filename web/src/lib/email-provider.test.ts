import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EmailProviderAuthError,
  EmailProviderRequestError,
  EmailProviderResponseError,
  createResendEmailProvider,
} from "./email-provider";

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createResendEmailProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the real provider message id on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "re_abc123" }));
    const provider = createResendEmailProvider("re_key", "noreply@example.com");

    const result = await provider.send(
      { to: "user@example.com", subject: "Hello", text: "Body" },
      new AbortController().signal,
    );

    expect(result).toEqual({ providerMessageId: "re_abc123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer re_key" }),
      }),
    );
  });

  it("throws EmailProviderResponseError when the response has no real id, never treating a 200 as success by itself", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const provider = createResendEmailProvider("re_key", "noreply@example.com");

    await expect(
      provider.send({ to: "user@example.com", subject: "Hello", text: "Body" }, new AbortController().signal),
    ).rejects.toBeInstanceOf(EmailProviderResponseError);
  });

  it("throws EmailProviderResponseError when the id field is present but blank", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "   " }));
    const provider = createResendEmailProvider("re_key", "noreply@example.com");

    await expect(
      provider.send({ to: "user@example.com", subject: "Hello", text: "Body" }, new AbortController().signal),
    ).rejects.toBeInstanceOf(EmailProviderResponseError);
  });

  it("throws EmailProviderAuthError on 401", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "unauthorized" }, { status: 401 }));
    const provider = createResendEmailProvider("bad_key", "noreply@example.com");

    await expect(
      provider.send({ to: "user@example.com", subject: "Hello", text: "Body" }, new AbortController().signal),
    ).rejects.toBeInstanceOf(EmailProviderAuthError);
  });

  it("throws EmailProviderAuthError on 403", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "forbidden" }, { status: 403 }));
    const provider = createResendEmailProvider("bad_key", "noreply@example.com");

    await expect(
      provider.send({ to: "user@example.com", subject: "Hello", text: "Body" }, new AbortController().signal),
    ).rejects.toBeInstanceOf(EmailProviderAuthError);
  });

  it("throws EmailProviderRequestError on any other non-2xx status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "server error" }, { status: 500 }));
    const provider = createResendEmailProvider("re_key", "noreply@example.com");

    await expect(
      provider.send({ to: "user@example.com", subject: "Hello", text: "Body" }, new AbortController().signal),
    ).rejects.toBeInstanceOf(EmailProviderRequestError);
  });

  it("propagates an abort as a rejection (caller classifies it as a timeout)", async () => {
    fetchMock.mockImplementation(() => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });
    const provider = createResendEmailProvider("re_key", "noreply@example.com");
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.send({ to: "user@example.com", subject: "Hello", text: "Body" }, controller.signal),
    ).rejects.toThrow();
  });

  it("sends the exact recipient, subject, text, and from address", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "re_abc123" }));
    const provider = createResendEmailProvider("re_key", "noreply@example.com");

    await provider.send(
      { to: "user@example.com", subject: "Welcome", text: "Hi there" },
      new AbortController().signal,
    );

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({
      from: "noreply@example.com",
      to: "user@example.com",
      subject: "Welcome",
      text: "Hi there",
    });
  });

  it("includes html in the request body when provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "re_abc123" }));
    const provider = createResendEmailProvider("re_key", "noreply@example.com");

    await provider.send(
      { to: "user@example.com", subject: "Welcome", text: "Hi there", html: "<p>Hi there</p>" },
      new AbortController().signal,
    );

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({
      from: "noreply@example.com",
      to: "user@example.com",
      subject: "Welcome",
      text: "Hi there",
      html: "<p>Hi there</p>",
    });
  });

  it("omits html from the request body when not provided (unchanged behavior for text-only emails)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "re_abc123" }));
    const provider = createResendEmailProvider("re_key", "noreply@example.com");

    await provider.send(
      { to: "user@example.com", subject: "Welcome", text: "Hi there" },
      new AbortController().signal,
    );

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body).not.toHaveProperty("html");
  });
});
