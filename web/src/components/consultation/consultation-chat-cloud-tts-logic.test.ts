import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { synthesizeCloudVoiceReply } from "./consultation-chat-cloud-tts-logic";

function okResponse(blob: Blob): Response {
  return { ok: true, blob: async () => blob } as unknown as Response;
}

function notOkResponse(status: number, errorBody: { error?: string; message?: string } = { error: "VOICE_REPLY_UNAVAILABLE" }): Response {
  const response = {
    ok: false,
    status,
    clone: () => ({ json: async () => errorBody }),
  };
  return response as unknown as Response;
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

// Regression: a live production report ("No Romanian voice is installed...
// reading with the browser's default voice instead") only ever proved
// cloud TTS was attempted and fell back -- never WHY. This client-side
// logging (mirroring teach-ai-panel-logic.ts's VOICE_TRANSCRIPT_CLIENT
// convention) is what makes that distinguishable from a browser console
// read on the next live retest, without guessing.
describe("VOICE_REPLY_CLIENT diagnostics logging", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function loggedLines(): Record<string, unknown>[] {
    return logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
  }

  it("logs request_initiated with the language and text length, never the reply text itself", async () => {
    await synthesizeCloudVoiceReply(
      "client-1",
      "the client's actual private consultation reply text",
      "ro",
      { fetch: vi.fn().mockResolvedValue(okResponse(new Blob(["audio"]))) },
      { onSuccess: () => {}, onFailure: () => {} },
    );

    const initiated = loggedLines().find((line) => line.event === "request_initiated");
    expect(initiated).toMatchObject({ tag: "VOICE_REPLY_CLIENT", language: "ro", textLength: 51 });
    expect(JSON.stringify(loggedLines())).not.toContain("private consultation reply text");
  });

  // The exact diagnostic gap this logging closes: distinguishing "cloud
  // not configured" from a real provider failure used to be impossible
  // from the client alone -- now the route's own error code is read from
  // the response body and logged.
  it("logs the SPECIFIC error code from the response body on a non-ok response, not just 'failed'", async () => {
    await synthesizeCloudVoiceReply(
      "client-1",
      "text",
      "ro",
      { fetch: vi.fn().mockResolvedValue(notOkResponse(503, { error: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED" })) },
      { onSuccess: () => {}, onFailure: () => {} },
    );

    const notOk = loggedLines().find((line) => line.event === "response_not_ok");
    expect(notOk).toMatchObject({ tag: "VOICE_REPLY_CLIENT", status: 503, errorCode: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED" });
  });

  it("logs a distinct error code for a rate-limited response, distinguishable from not-configured", async () => {
    await synthesizeCloudVoiceReply(
      "client-1",
      "text",
      "ro",
      { fetch: vi.fn().mockResolvedValue(notOkResponse(503, { error: "VOICE_REPLY_RATE_LIMITED" })) },
      { onSuccess: () => {}, onFailure: () => {} },
    );

    const notOk = loggedLines().find((line) => line.event === "response_not_ok");
    expect(notOk).toMatchObject({ errorCode: "VOICE_REPLY_RATE_LIMITED" });
  });

  it("logs errorCode 'unknown' rather than throwing when the failure response body isn't valid JSON", async () => {
    const brokenResponse = {
      ok: false,
      status: 502,
      clone: () => ({ json: async () => { throw new Error("not json"); } }),
    } as unknown as Response;
    const onFailure = vi.fn();

    await synthesizeCloudVoiceReply("client-1", "text", "ro", { fetch: vi.fn().mockResolvedValue(brokenResponse) }, { onSuccess: () => {}, onFailure });

    expect(onFailure).toHaveBeenCalledWith("unavailable");
    const notOk = loggedLines().find((line) => line.event === "response_not_ok");
    expect(notOk).toMatchObject({ errorCode: "unknown" });
  });

  it("logs fetch_threw with the real error name/message when the request never reaches the server", async () => {
    await synthesizeCloudVoiceReply(
      "client-1",
      "text",
      "ro",
      { fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) },
      { onSuccess: () => {}, onFailure: () => {} },
    );

    const threw = loggedLines().find((line) => line.event === "fetch_threw");
    expect(threw).toMatchObject({ tag: "VOICE_REPLY_CLIENT", errorName: "TypeError", errorMessage: "Failed to fetch" });
  });

  it("logs success with the audio byte size, never the reply text", async () => {
    await synthesizeCloudVoiceReply(
      "client-1",
      "the client's actual private consultation reply text",
      "ro",
      { fetch: vi.fn().mockResolvedValue(okResponse(new Blob(["fake-wav-bytes"]))) },
      { onSuccess: () => {}, onFailure: () => {} },
    );

    const success = loggedLines().find((line) => line.event === "success");
    expect(success).toMatchObject({ tag: "VOICE_REPLY_CLIENT", audioBytes: 14 });
  });
});
