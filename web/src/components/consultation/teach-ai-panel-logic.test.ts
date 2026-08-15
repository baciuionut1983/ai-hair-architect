import { describe, expect, it, vi } from "vitest";

import { bindFetch, finishRecording, type VoiceNoteStreamLike } from "./teach-ai-panel-logic";

function fakeStream(): { stream: VoiceNoteStreamLike; stopped: boolean[] } {
  const stopped: boolean[] = [];
  const stream: VoiceNoteStreamLike = {
    getTracks: () => [{ stop: () => stopped.push(true) }, { stop: () => stopped.push(true) }],
  };
  return { stream, stopped };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 502): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function callbackSpies() {
  return {
    onStopped: vi.fn(),
    onFailure: vi.fn(),
    onSuccess: vi.fn(),
  };
}

describe("finishRecording", () => {
  // Regression: a live production report -- after manually stopping the
  // recorder, "Listening..." stayed on screen forever, with no transcript,
  // no processing indicator, and no error message at all. Root cause was
  // an async onstop handler with zero error handling, so any failure
  // became a silently swallowed unhandled promise rejection. These lock in
  // that the UI can never again get stuck that way.

  it("1: always calls onStopped (replacing 'Listening...') synchronously, before the network request resolves", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    let resolveFetch!: (value: Response) => void;
    const hangingFetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));

    const pending = finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: hangingFetch });

    // onStopped must already have fired even though the fetch is still pending.
    expect(callbacks.onStopped).toHaveBeenCalledTimes(1);
    expect(callbacks.onFailure).not.toHaveBeenCalled();
    expect(callbacks.onSuccess).not.toHaveBeenCalled();

    resolveFetch(jsonResponse({ transcript: "note", transcriptId: "t-1" }));
    await pending;
  });

  it("2: stops every stream track when finishing, regardless of transcription outcome", async () => {
    const { stream, stopped } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(stopped).toEqual([true, true]);
  });

  it("3: starts the transcription request against this exact client's voice-transcript endpoint with the recorded audio", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-42", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/clients/client-42/voice-transcript");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("4: delivers the resulting transcript and transcriptId to onSuccess when the response is ok", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "Low density in the temporal areas.", transcriptId: "t-9" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(callbacks.onSuccess).toHaveBeenCalledWith("Low density in the temporal areas.", "t-9");
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it("5a: calls onFailure with the server's own message and never onSuccess when the response is not ok (e.g. provider not configured)", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "Voice transcription is not configured. You can still teach the AI by typing." }, false, 503),
    );

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription is not configured. You can still teach the AI by typing.");
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });

  it("5b: calls onFailure with a clear fallback message when the response is not ok and carries no message field", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED" }, false, 502));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.");
  });

  // The exact previously-silent failure mode: the fetch call itself throws
  // (a network error). Before this fix, this was inside an async onstop
  // with no try/catch -- an unhandled rejection, no UI update at all.
  it("5c: calls onFailure with a clear message (never leaving the UI stuck) when the fetch call itself throws", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const throwingFetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: throwingFetch });

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.");
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });

  // Another previously-silent failure mode: a response that claims to be ok
  // but whose body is not valid JSON (response.json() throws).
  it("5d: calls onFailure with a clear message when the response body cannot be parsed as JSON", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const badJsonResponse = { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } } as unknown as Response;
    const fetchStub = vi.fn(async () => badJsonResponse);

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.");
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });

  it("onStopped always fires even when the subsequent transcription fails -- the UI is never left stuck on 'Listening...'", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const throwingFetch = vi.fn(async () => { throw new Error("network down"); });

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: throwingFetch });

    expect(callbacks.onStopped).toHaveBeenCalledTimes(1);
    expect(callbacks.onFailure).toHaveBeenCalledTimes(1);
  });

  it("never calls both onFailure and onSuccess for the same recording", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it("falls back to audio/webm when the recorder reports no mimeType", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "", "client-1", callbacks, { fetch: fetchStub });

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    const audio = form.get("audio") as Blob;
    expect(audio.type).toBe("audio/webm");
  });
});

// Regression: a live report reproduced "Voice transcription failed" with
// ZERO matching VOICE_TRANSCRIPT lines in Railway's Deploy Logs afterward
// -- meaning the backend's own logging (however thorough) could not tell
// us whether the request ever left the browser. These lock in that every
// step up to and including the fetch call is now independently observable
// client-side, and that the three distinct failure shapes (fetch itself
// throwing vs. a non-JSON response body vs. an ordinary application-level
// !ok) are logged as three different, greppable event names -- never the
// same undifferentiated "it failed" -- while never logging audio bytes,
// transcript content, or any token/cookie.
describe("finishRecording client-side diagnostics", () => {
  function loggedEvents(logSpy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
    return logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
  }

  it("logs recording_stopped, blob_created (mimeType+size), and request_initiated, in order, before any network result", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let resolveFetch!: (value: Response) => void;
    const hangingFetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));

    const pending = finishRecording(stream, [new Blob(["hello"])], "audio/webm", "client-1", callbacks, { fetch: hangingFetch });

    const events = loggedEvents(logSpy).map((e) => e.event);
    expect(events).toEqual(["recording_stopped", "blob_created", "request_initiated"]);
    const blobEvent = loggedEvents(logSpy).find((e) => e.event === "blob_created");
    expect(blobEvent).toMatchObject({ mimeType: "audio/webm", sizeBytes: 5 });

    resolveFetch(jsonResponse({ transcript: "note", transcriptId: "t-1" }));
    await pending;
    logSpy.mockRestore();
  });

  it("distinguishes fetch_threw (never reached any server) from response_json_parse_threw (a server responded, but not with JSON) as two different event names", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { stream: streamA } = fakeStream();
    await finishRecording(streamA, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), {
      fetch: vi.fn(async () => { throw new TypeError("Failed to fetch"); }),
    });
    expect(loggedEvents(logSpy).some((e) => e.event === "fetch_threw")).toBe(true);
    expect(loggedEvents(logSpy).some((e) => e.event === "response_json_parse_threw")).toBe(false);

    logSpy.mockClear();

    const { stream: streamB } = fakeStream();
    const nonJsonResponse = { ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response;
    await finishRecording(streamB, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), {
      fetch: vi.fn(async () => nonJsonResponse),
    });
    expect(loggedEvents(logSpy).some((e) => e.event === "response_json_parse_threw")).toBe(true);
    expect(loggedEvents(logSpy).some((e) => e.event === "fetch_threw")).toBe(false);

    logSpy.mockRestore();
  });

  it("logs response_received with the real HTTP status even for a non-ok response, before classifying it", async () => {
    const { stream } = fakeStream();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchStub = vi.fn(async () => jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED" }, false, 502));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), { fetch: fetchStub });

    expect(loggedEvents(logSpy)).toContainEqual(expect.objectContaining({ event: "response_received", status: 502, ok: false }));
    logSpy.mockRestore();
  });

  it("logs success with only the transcript's length, never its actual content", async () => {
    const { stream } = fakeStream();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const transcript = "Low density in the temporal areas.";
    const fetchStub = vi.fn(async () => jsonResponse({ transcript, transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), { fetch: fetchStub });

    const successEvent = loggedEvents(logSpy).find((e) => e.event === "success");
    expect(successEvent).toMatchObject({ transcriptLength: transcript.length });
    expect(JSON.stringify(loggedEvents(logSpy))).not.toContain("Low density");
    logSpy.mockRestore();
  });

  it("never logs the audio blob's own content, only its mimeType and byte size", async () => {
    const { stream } = fakeStream();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["super-secret-chair-side-note"])], "audio/webm", "client-1", callbackSpies(), { fetch: fetchStub });

    expect(JSON.stringify(loggedEvents(logSpy))).not.toContain("super-secret-chair-side-note");
    logSpy.mockRestore();
  });

  // The outer, defensive catch-all -- preserves the original stuck-UI fix's
  // guarantee even for a failure that isn't fetch- or JSON-parsing-related.
  it("falls back to the outer catch-all (unexpected_error) and still calls onFailure if Blob construction itself throws", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // `new Blob(null, ...)` throws a real TypeError ("Value cannot be
    // converted to sequence") -- a legitimate way to exercise the outer,
    // defensive catch-all without relying on a contrived mock.
    const malformedChunks = null as unknown as Blob[];

    await finishRecording(stream, malformedChunks, "audio/webm", "client-1", callbacks, { fetch: vi.fn() });

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.");
    expect(loggedEvents(logSpy).some((e) => e.event === "unexpected_error")).toBe(true);
    logSpy.mockRestore();
  });
});

// Regression: the demonstrated live production cause. `{ fetch }` (the
// bare global reference) stored as a plain object's property throws when
// a REAL browser's native fetch is later invoked as `deps.fetch(...)`:
// "TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation".
// This reproduces the browser's actual `this`-binding requirement with a
// test double, since a mocked fetch (vi.fn(), used by every other test in
// this file) never checks `this` at all -- which is exactly why the bug
// reached production invisibly despite full test coverage of
// finishRecording itself.
describe("bindFetch", () => {
  // Simulates a real browser's native fetch: it only works when called
  // with `this === globalThis` (the actual window object in a browser) --
  // exactly the constraint bindFetch.bind(globalThis) satisfies. Any other
  // receiver (e.g. a plain `deps` object storing the bare reference) is
  // rejected, matching the real "Illegal invocation" error.
  function brandedFetchDouble(): typeof fetch {
    function fetchLike(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response("{}"));
    }
    return fetchLike as unknown as typeof fetch;
  }

  it("reproduces the exact production bug: a bare extracted reference throws Illegal invocation when called as a plain object's method", () => {
    const nativeFetch = brandedFetchDouble();

    // This is exactly `{ fetch }` from teach-ai-panel.tsx before the fix:
    // the bare reference, called through a plain object, so `this` is
    // that object, not globalThis.
    const buggyDeps = { fetch: nativeFetch };

    expect(() => buggyDeps.fetch("/api/v1/clients/client-1/voice-transcript")).toThrow(/Illegal invocation/);
  });

  it("fixes it: the bound function works correctly when called as a plain object's method", () => {
    const nativeFetch = brandedFetchDouble();

    const fixedDeps = { fetch: bindFetch(nativeFetch) };

    expect(() => fixedDeps.fetch("/api/v1/clients/client-1/voice-transcript")).not.toThrow();
  });

  it("still calls through to the real underlying fetch (not a no-op stub)", async () => {
    const nativeFetch = brandedFetchDouble();

    const bound = bindFetch(nativeFetch);
    const response = await bound("/api/v1/clients/client-1/voice-transcript");

    expect(response).toBeInstanceOf(Response);
  });
});
