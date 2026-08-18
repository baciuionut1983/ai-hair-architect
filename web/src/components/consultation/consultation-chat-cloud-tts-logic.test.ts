import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logVoiceReplyClientEvent, synthesizeCloudVoiceReply } from "./consultation-chat-cloud-tts-logic";
import { speakReply, type SpeakReplyDeps } from "./consultation-chat-tts-logic";
import { bindFetch } from "./teach-ai-panel-logic";

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

  // Voice reliability hardening (2026-08-18): when consultation-chat.tsx
  // supersedes this attempt (a second message sent, or Stop pressed)
  // before it resolves, it aborts the request via this optional signal --
  // purely a network-efficiency improvement (the component's own
  // voiceReplyAttemptRef token guard already makes acting on a stale
  // response impossible regardless of whether the fetch itself is
  // aborted).
  it("forwards an optional AbortSignal to the fetch call when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(new Blob(["audio"])));
    const controller = new AbortController();

    await synthesizeCloudVoiceReply("client-1", "text", "en", { fetch: fetchMock, signal: controller.signal }, { onSuccess: () => {}, onFailure: () => {} });

    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBe(controller.signal);
  });

  it("never sends a signal field at all when none is provided -- existing call sites keep working unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(new Blob(["audio"])));

    await synthesizeCloudVoiceReply("client-1", "text", "en", { fetch: fetchMock }, { onSuccess: () => {}, onFailure: () => {} });

    const init = fetchMock.mock.calls[0][1];
    expect("signal" in init).toBe(false);
  });

  it("calls onFailure('network') when the request is aborted mid-flight -- the same path as any other fetch-threw failure", async () => {
    const onFailure = vi.fn();
    const controller = new AbortController();
    const abortingFetch = vi.fn(() => {
      controller.abort();
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    });

    await synthesizeCloudVoiceReply("client-1", "text", "en", { fetch: abortingFetch, signal: controller.signal }, { onSuccess: () => {}, onFailure });

    expect(onFailure).toHaveBeenCalledWith("network");
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

    const initiated = loggedLines().find((line) => line.event === "cloud_request_initiated");
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

    const notOk = loggedLines().find((line) => line.event === "cloud_response_not_ok");
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

    const notOk = loggedLines().find((line) => line.event === "cloud_response_not_ok");
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
    const notOk = loggedLines().find((line) => line.event === "cloud_response_not_ok");
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

    const threw = loggedLines().find((line) => line.event === "cloud_fetch_threw");
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

    const success = loggedLines().find((line) => line.event === "cloud_success");
    expect(success).toMatchObject({ tag: "VOICE_REPLY_CLIENT", audioBytes: 14 });
  });
});

// Regression: this exact tag ("VOICE_REPLY_CLIENT") is shared with
// consultation-chat-tts-logic.ts's own local-Web-Speech logging -- a live
// retest that filtered the browser console by this tag saw only the
// OTHER file's event and concluded (correctly, as it turned out, but only
// after a lot of other verification) that cloud TTS logging never ran at
// all. These lock in that every event name from EITHER source stays
// unambiguous about its own origin, so a console read alone -- without
// needing to know two files exist -- can always tell them apart.
describe("VOICE_REPLY_CLIENT event names stay unambiguous across both log sources", () => {
  it("every event this file logs is cloud_-prefixed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await synthesizeCloudVoiceReply(
        "client-1", "text", "ro",
        { fetch: vi.fn().mockResolvedValue(okResponse(new Blob(["audio"]))) },
        { onSuccess: () => {}, onFailure: () => {} },
      );
      logVoiceReplyClientEvent("cloud_custom_event_used_directly");

      const events = logSpy.mock.calls.map((call) => (JSON.parse(call[0] as string) as { event: string }).event);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.startsWith("cloud_")).toBe(true);
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  it("the local Web Speech fallback's own event is local_-prefixed, never colliding with a cloud_ event name", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const synth: SpeakReplyDeps["synth"] = {
        speak: () => {},
        cancel: () => {},
        resume: () => {},
        getVoices: () => [],
      };
      const createUtterance: SpeakReplyDeps["createUtterance"] = () => ({
        lang: "", voice: null, onstart: null, onend: null, onerror: null,
      });

      speakReply("Bună ziua.", "ro-RO", { synth, createUtterance }, { onStart: () => {}, onEnd: () => {}, onError: () => {} });

      const events = logSpy.mock.calls.map((call) => (JSON.parse(call[0] as string) as { event: string }).event);
      expect(events).toContain("local_speak_requested");
      expect(events.some((event) => event.startsWith("cloud_"))).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});

// Regression: the demonstrated live production cause, confirmed live via
// this file's own cloud_fetch_threw logging -- cloud TTS WAS selected and
// WAS attempted (speak_message_branch_decision showed cloudSupported:true,
// cloud_request_initiated fired), but the fetch call itself threw
// "TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation"
// before any network request could be made. Root cause: consultation-
// chat.tsx used to pass `{ fetch }` (object shorthand for
// `{ fetch: fetch }`) to synthesizeCloudVoiceReply -- the bare global
// function reference stored as a plain object's property. A real
// browser's native fetch is a *branded* method requiring `this` to be
// exactly the window/global object it's defined on; calling it later as
// `deps.fetch(...)` invokes it with `this === deps` (plain method-call
// syntax always binds `this` to the object before the dot), which throws
// synchronously. This is the EXACT same bug class already fixed once in
// teach-ai-panel-logic.ts's own bindFetch (see that file's own regression
// note) -- it reached this SECOND call site because a mocked fetch
// (vi.fn(), used by every other test in this file) never checks `this`
// at all, so full test coverage of synthesizeCloudVoiceReply itself never
// caught it; only a test double that reproduces the browser's real
// `this`-binding requirement can.
describe("fetch this-binding regression (the exact live production bug)", () => {
  // Simulates a real browser's native fetch: only works when called with
  // `this === globalThis` (the real window object in a browser) -- exactly
  // the constraint bindFetch(fetch).bind(globalThis) satisfies. Any other
  // receiver (e.g. a plain deps object storing the bare reference) is
  // rejected, matching the real "Illegal invocation" error the user's
  // live retest reproduced byte-for-byte.
  function brandedFetchDouble(): typeof fetch {
    function fetchLike(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response(new Blob(["audio"])));
    }
    return fetchLike as unknown as typeof fetch;
  }

  it("reproduces the exact production bug: an unbound fetch reference makes cloud TTS fall back to 'network', never reaching the server", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const onFailure = vi.fn();
    try {
      // This is exactly `{ fetch }` from consultation-chat.tsx before the
      // fix: the bare reference, invoked as synthesizeCloudVoiceReply's
      // own `deps.fetch(...)` call, so `this` is `deps`, not globalThis.
      await synthesizeCloudVoiceReply(
        "client-1", "text", "ro",
        { fetch: brandedFetchDouble() },
        { onSuccess: () => {}, onFailure },
      );

      expect(onFailure).toHaveBeenCalledWith("network");
      const events = logSpy.mock.calls.map((call) => (JSON.parse(call[0] as string) as { event: string; errorMessage?: string }));
      const threw = events.find((line) => line.event === "cloud_fetch_threw");
      expect(threw?.errorMessage).toContain("Illegal invocation");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fixes it: wrapping with bindFetch (exactly what consultation-chat.tsx does now) lets the real request go through", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await synthesizeCloudVoiceReply(
      "client-1", "text", "ro",
      { fetch: bindFetch(brandedFetchDouble()) },
      { onSuccess, onFailure },
    );

    expect(onFailure).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
