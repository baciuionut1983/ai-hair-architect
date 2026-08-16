import { describe, expect, it, vi } from "vitest";

import { synthesizeCloudVoiceReply } from "./consultation-chat-cloud-tts-logic";

function okResponse(blob: Blob): Response {
  return { ok: true, blob: async () => blob } as unknown as Response;
}

function notOkResponse(status: number): Response {
  return { ok: false, status } as unknown as Response;
}

describe("synthesizeCloudVoiceReply", () => {
  it("posts the exact clientId/text/language to voice-reply, never a second re-worded request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(new Blob(["audio"])));
    await synthesizeCloudVoiceReply(
      "client-1",
      "Clienta va reveni saptamana viitoare.",
      "ro",
      { fetch: fetchMock },
      { onSuccess: () => {}, onFailure: () => {} },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/clients/client-1/voice-reply");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ text: "Clienta va reveni saptamana viitoare.", language: "ro" });
  });

  it("calls onSuccess with the response blob on a 2xx response", async () => {
    const blob = new Blob(["fake-wav-bytes"]);
    const onSuccess = vi.fn();
    await synthesizeCloudVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: vi.fn().mockResolvedValue(okResponse(blob)) },
      { onSuccess, onFailure: () => {} },
    );
    expect(onSuccess).toHaveBeenCalledWith(blob);
  });

  it("calls onFailure('unavailable') for a non-2xx response, without throwing", async () => {
    const onFailure = vi.fn();
    await synthesizeCloudVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: vi.fn().mockResolvedValue(notOkResponse(503)) },
      { onSuccess: () => {}, onFailure },
    );
    expect(onFailure).toHaveBeenCalledWith("unavailable");
  });

  it("calls onFailure('network') when fetch itself throws (offline, CORS, request never left the browser)", async () => {
    const onFailure = vi.fn();
    await synthesizeCloudVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) },
      { onSuccess: () => {}, onFailure },
    );
    expect(onFailure).toHaveBeenCalledWith("network");
  });

  it("calls onFailure('unavailable') when the 2xx response body can't be read as a blob", async () => {
    const onFailure = vi.fn();
    const brokenResponse = { ok: true, blob: async () => { throw new Error("boom"); } } as unknown as Response;
    await synthesizeCloudVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: vi.fn().mockResolvedValue(brokenResponse) },
      { onSuccess: () => {}, onFailure },
    );
    expect(onFailure).toHaveBeenCalledWith("unavailable");
  });

  it("works for languages well beyond en/ro -- Arabic, Japanese, Korean, Chinese", async () => {
    for (const language of ["ar", "ja", "ko", "zh-Hans"]) {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(new Blob(["audio"])));
      await synthesizeCloudVoiceReply("client-1", "text", language, { fetch: fetchMock }, { onSuccess: () => {}, onFailure: () => {} });
      const init = fetchMock.mock.calls[0][1];
      expect(JSON.parse(init.body).language).toBe(language);
    }
  });
});
