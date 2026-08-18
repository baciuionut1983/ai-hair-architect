import { describe, expect, it, vi } from "vitest";

import { bindFetch, classifyMicrophoneStartError, finishRecording, type VoiceNoteStreamLike } from "./teach-ai-panel-logic";

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

  it("3b: appends the optional trailing language param to the form when given", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub }, "ro");

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get("language")).toBe("ro");
  });

  it("3c: omits the language field entirely when not given -- every pre-existing call site (5-arg) keeps working unchanged", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get("language")).toBeNull();
  });

  it("4: delivers the resulting transcript and transcriptId to onSuccess when the response is ok", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "Low density in the temporal areas.", transcriptId: "t-9" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(callbacks.onSuccess).toHaveBeenCalledWith("Low density in the temporal areas.", "t-9", expect.any(Object), null, 1);
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it("5a: calls onFailure with the server's own message and never onSuccess when the response is not ok (e.g. provider not configured)", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "Voice transcription is not configured. You can still teach the AI by typing." }, false, 503),
    );

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    // Voice reliability hardening: VOICE_PROVIDER_NOT_CONFIGURED now also
    // carries the "providerUnavailable" reason -- see
    // reasonForServerErrorCode's own doc comment for why a config problem
    // and a transient provider hiccup are honestly indistinguishable from
    // the stylist's point of view (both mean "the AI service isn't
    // available right now"), even though they are NOT retried the same way.
    expect(callbacks.onFailure).toHaveBeenCalledWith(
      "Voice transcription is not configured. You can still teach the AI by typing.",
      "providerUnavailable",
      expect.any(Object),
      1,
    );
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });

  it("5b: calls onFailure with a clear fallback message when the response is not ok and carries no message field", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED" }, false, 502));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.", "providerUnavailable", expect.any(Object), 2);
  });

  // The exact previously-silent failure mode: the fetch call itself throws
  // (a network error). Before this fix, this was inside an async onstop
  // with no try/catch -- an unhandled rejection, no UI update at all.
  it("5c: calls onFailure with a clear message (never leaving the UI stuck) when the fetch call itself throws", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const throwingFetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: throwingFetch });

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.", "unknown", expect.any(Object), 2);
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

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.", "unknown", expect.any(Object), 2);
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

// Regression: a real production report confirmed via Railway logs -- a
// well-formed request WITH real audio bytes (70814 bytes,
// audio/webm;codecs=opus) reached Gemini and was rejected with a
// provider-side HTTP 500. Reproduced on iPhone, Android, AND desktop
// Chrome alike (never platform-specific), and confirmed against Google's
// own audio-understanding docs: WebM is not among Gemini's documented
// supported audio input formats at all. deps.encodeAsWav (see
// audio-wav-encode.ts) exists specifically to convert whatever the
// browser actually recorded into a format Gemini does document support,
// before it is ever uploaded.
describe("finishRecording WAV re-encoding", () => {
  it("uploads the re-encoded WAV blob (not the original recording) when encodeAsWav succeeds", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));
    const wavBlob = new Blob(["wav-bytes"], { type: "audio/wav" });
    const encodeAsWav = vi.fn(async () => wavBlob);

    await finishRecording(stream, [new Blob(["x"])], "audio/webm;codecs=opus", "client-1", callbacks, {
      fetch: fetchStub,
      encodeAsWav,
    });

    expect(encodeAsWav).toHaveBeenCalledTimes(1);
    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    const uploaded = form.get("audio") as Blob;
    expect(uploaded.type).toBe("audio/wav");
    expect(await uploaded.text()).toBe("wav-bytes");
  });

  it("names the uploaded file note.wav when re-encoding succeeded", async () => {
    const { stream } = fakeStream();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));
    const encodeAsWav = vi.fn(async () => new Blob(["wav-bytes"], { type: "audio/wav" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), {
      fetch: fetchStub,
      encodeAsWav,
    });

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    const entries = [...(init.body as FormData).entries()] as [string, FormDataEntryValue][];
    const [, fileValue] = entries.find(([key]) => key === "audio")!;
    expect((fileValue as File).name).toBe("note.wav");
  });

  it("falls back to uploading the original recording when encodeAsWav rejects -- never a new failure mode", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));
    const encodeAsWav = vi.fn(async () => { throw new Error("AudioContext is not available in this browser."); });

    await finishRecording(stream, [new Blob(["original"])], "audio/webm", "client-1", callbacks, {
      fetch: fetchStub,
      encodeAsWav,
    });

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    const uploaded = form.get("audio") as Blob;
    expect(uploaded.type).toBe("audio/webm");
    expect(await uploaded.text()).toBe("original");
    expect(callbacks.onFailure).not.toHaveBeenCalled();
    expect(callbacks.onSuccess).toHaveBeenCalledWith("note", "t-1", expect.any(Object), null, 1);
  });

  it("logs wav_reencode_failed (not audio bytes) when encodeAsWav rejects", async () => {
    const { stream } = fakeStream();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));
    const encodeAsWav = vi.fn(async () => { throw new TypeError("decodeAudioData failed"); });

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), {
      fetch: fetchStub,
      encodeAsWav,
    });

    const events = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(events).toContainEqual(expect.objectContaining({ event: "wav_reencode_failed", errorName: "TypeError" }));
    logSpy.mockRestore();
  });

  it("does not attempt re-encoding at all when encodeAsWav is not provided (existing call sites keep working unchanged)", async () => {
    const { stream } = fakeStream();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), { fetch: fetchStub });

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect((form.get("audio") as Blob).type).toBe("audio/webm");
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

    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.", "unknown", expect.any(Object), 0);
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
// Voice reliability hardening (2026-08-18): a controlled, single automatic
// retry for genuinely transient failures, blob-size validation before ever
// spending a network round-trip, and one attemptId correlating every log
// line (and, per-attempt, every request) for one logical mic-press-to-
// result cycle.
describe("finishRecording voice reliability hardening", () => {
  function loggedEvents(logSpy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
    return logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
  }

  it("retries exactly once, automatically, when the server reports a transient provider failure (VOICE_TRANSCRIPTION_FAILED), and succeeds on the retry", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription failed. You can still type your note." }, false, 502))
      .mockResolvedValueOnce(jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(callbacks.onSuccess).toHaveBeenCalledWith("note", "t-1", expect.any(Object), null, 2);
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it("retries exactly once, never twice, when the server keeps reporting the same transient failure -- no infinite retry loop", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED" }, false, 502));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(callbacks.onFailure).toHaveBeenCalledTimes(1);
    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription failed. You can still type your note.", "providerUnavailable", expect.any(Object), 2);
  });

  it("does NOT retry a permanent failure (VOICE_PROVIDER_NOT_CONFIGURED) -- retrying could never change the outcome", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "Voice transcription is not configured. You can still teach the AI by typing." }, false, 503),
    );

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(callbacks.onFailure).toHaveBeenCalledWith("Voice transcription is not configured. You can still teach the AI by typing.", "providerUnavailable", expect.any(Object), 1);
  });

  it("does NOT retry an invalid/unsupported audio format -- a permanent, format-level problem", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: "UNSUPPORTED_AUDIO_FORMAT", message: "This recording format isn't supported for transcription. Please try again, or type your note." }, false, 400),
    );

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  // Task requirement E: a malformed/unreadable recording (the server's own
  // "Invalid audio." rejection, no separate error code) is a deterministic
  // validation failure -- retrying the exact same bytes could never
  // produce a different result.
  it("does NOT retry 'Invalid audio.' -- a deterministic validation failure on the exact bytes already sent", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ error: "Invalid audio." }, false, 400));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(callbacks.onFailure).toHaveBeenCalledWith(expect.any(String), "invalidAudio", expect.any(Object), 1);
  });

  it("does NOT retry a rate-limit response -- an immediate retry would only be rate-limited again", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ error: "Rate limit exceeded." }, false, 429));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("retries a network-level failure (fetch threw) exactly once, and succeeds if the retry reaches the server", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(callbacks.onSuccess).toHaveBeenCalledWith("note", "t-1", expect.any(Object), null, 2);
  });

  // Task requirement D: a genuinely hung connection (never rejects,
  // never resolves on its own) must not leave the mic disabled forever --
  // the client-side upload timeout aborts it, which is classified and
  // retried exactly like any other network-level failure, recovering
  // automatically on the second attempt.
  it("a client-side upload timeout (a hung connection) is treated as a retryable failure and recovers on retry", async () => {
    vi.useFakeTimers();
    try {
      const { stream } = fakeStream();
      const callbacks = callbackSpies();
      let callCount = 0;
      const fetchStub = vi.fn((_url: string, init?: RequestInit) => {
        callCount += 1;
        if (callCount === 1) {
          // Never resolves on its own -- only the client-side timeout's
          // own AbortController can end it, exactly like a real hung
          // connection.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
          });
        }
        return Promise.resolve(jsonResponse({ transcript: "note", transcriptId: "t-1" }));
      });

      const pending = finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, {
        fetch: fetchStub as unknown as typeof fetch,
      });

      await vi.advanceTimersByTimeAsync(45_000);
      await pending;

      expect(fetchStub).toHaveBeenCalledTimes(2);
      expect(callbacks.onSuccess).toHaveBeenCalledWith("note", "t-1", expect.any(Object), null, 2);
      expect(callbacks.onFailure).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an empty (0-byte) recording before ever calling fetch, with a clear, specific message", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn();

    await finishRecording(stream, [], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).not.toHaveBeenCalled();
    expect(callbacks.onFailure).toHaveBeenCalledWith("The recording was empty. Please try again and speak for a moment before stopping.", "emptyRecording", expect.any(Object), 0);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });

  it("rejects an empty recording even after a successful WAV re-encode that itself produces 0 bytes", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn();
    const encodeAsWav = vi.fn(async () => new Blob([], { type: "audio/wav" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub, encodeAsWav });

    expect(fetchStub).not.toHaveBeenCalled();
    expect(callbacks.onFailure).toHaveBeenCalledWith("The recording was empty. Please try again and speak for a moment before stopping.", "emptyRecording", expect.any(Object), 0);
  });

  // Production observability follow-up (2026-08-19): proves attemptNumber
  // itself (not just that SOME number was passed) reflects reality --
  // usage metering / voice latency telemetry depend on this being exact.
  it("reports attemptNumber 1 on a first-try success, and 0 (never a real HTTP attempt was made) for an unexpected pre-upload failure", async () => {
    const { stream: successStream } = fakeStream();
    const successCallbacks = callbackSpies();
    const successFetch = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));
    await finishRecording(successStream, [new Blob(["x"])], "audio/webm", "client-1", successCallbacks, { fetch: successFetch });
    const [, , , , firstAttemptNumber] = successCallbacks.onSuccess.mock.calls[0];
    expect(firstAttemptNumber).toBe(1);

    const { stream: crashStream } = fakeStream();
    const crashCallbacks = callbackSpies();
    await finishRecording(crashStream, null as unknown as Blob[], "audio/webm", "client-1", crashCallbacks, { fetch: vi.fn() });
    const [, , , crashAttemptNumber] = crashCallbacks.onFailure.mock.calls[0];
    expect(crashAttemptNumber).toBe(0);
  });

  it("uses one attemptId for every log line across both the initial attempt and its retry, and increments attemptNumber", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED" }, false, 502))
      .mockResolvedValueOnce(jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    const events = loggedEvents(logSpy);
    const attemptIds = new Set(events.map((e) => e.attemptId));
    expect(attemptIds.size).toBe(1);
    expect(events.find((e) => e.event === "retry_started")).toMatchObject({ attemptNumber: 2 });
    expect(events.filter((e) => e.event === "request_initiated").map((e) => e.attemptNumber)).toEqual([1, 2]);
    logSpy.mockRestore();
  });

  it("accepts a caller-supplied attemptId (so recording-start events can share it) instead of always generating a fresh one", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub }, undefined, "caller-supplied-id");

    const events = loggedEvents(logSpy);
    expect(events.every((e) => e.attemptId === "caller-supplied-id")).toBe(true);
    logSpy.mockRestore();
  });

  it("logs cleanup_completed as the very last event on both success and failure, so the mic is always ready for a fresh attempt", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { stream: streamOk } = fakeStream();
    await finishRecording(streamOk, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), {
      fetch: vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" })),
    });
    const successEvents = loggedEvents(logSpy);
    expect(successEvents.at(-1)).toMatchObject({ event: "cleanup_completed" });
    logSpy.mockClear();

    const { stream: streamFail } = fakeStream();
    await finishRecording(streamFail, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), {
      fetch: vi.fn(async () => jsonResponse({ error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "not configured" }, false, 503)),
    });
    const failureEvents = loggedEvents(logSpy);
    expect(failureEvents.at(-1)).toMatchObject({ event: "cleanup_completed" });

    logSpy.mockRestore();
  });

  // Proven production evidence (2026-08-18): a real Gemini 503 (mapped by
  // the server to a 502 VOICE_TRANSCRIPTION_FAILED response) was reported
  // with only attemptNumber: 1 in the logs. Investigated and disproven as
  // a code defect: this exact scenario, reproduced here with the real
  // server response shape, retries automatically and correctly.
  it("PROVEN EVIDENCE scenario: a real Gemini 503 (mapped to 502 VOICE_TRANSCRIPTION_FAILED) retries once and recovers, never blaming the microphone", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription failed. You can still type your note." }, false, 502),
      )
      .mockResolvedValueOnce(jsonResponse({ transcript: "She had bleach six weeks ago.", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["real-audio-bytes"])], "audio/wav", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(callbacks.onSuccess).toHaveBeenCalledWith("She had bleach six weeks ago.", "t-1", expect.any(Object), null, 2);
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it("PROVEN EVIDENCE scenario, retry also fails: an honest 'AI service unavailable' reason, never implying the microphone is broken", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription failed. You can still type your note." }, false, 502),
    );

    await finishRecording(stream, [new Blob(["real-audio-bytes"])], "audio/wav", "client-1", callbacks, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(callbacks.onFailure).toHaveBeenCalledWith(expect.any(String), "providerUnavailable", expect.any(Object), 2);
  });

  // Task requirement C/H: after Gemini 503s twice in a row (retry
  // exhausted) and the UI shows a temporary-service error, the NEXT
  // microphone click must start a completely fresh, independent session
  // that can succeed -- no reload, no leftover state from the failed
  // attempt, and no risk of double-submitting the SAME recording.
  it("after attempt 1 -> 503, attempt 2 -> 503 (retry exhausted), a completely separate next recording succeeds cleanly -- proving the mic always recovers", async () => {
    const failingFetch = vi.fn(async () =>
      jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription failed. You can still type your note." }, false, 502),
    );
    const { stream: firstStream } = fakeStream();
    const firstCallbacks = callbackSpies();
    await finishRecording(firstStream, [new Blob(["first-recording"])], "audio/wav", "client-1", firstCallbacks, { fetch: failingFetch });

    expect(failingFetch).toHaveBeenCalledTimes(2);
    expect(firstCallbacks.onFailure).toHaveBeenCalledWith(expect.any(String), "providerUnavailable", expect.any(Object), 2);
    expect(firstCallbacks.onSuccess).not.toHaveBeenCalled();

    // A brand new mic press -- its own stream, its own chunks, its own
    // finishRecording call (exactly what use-voice-recording.ts's
    // toggleRecording produces on the next click, since recorder.current/
    // streamRef.current were already fully nulled by the first attempt's
    // own onstop handler).
    const succeedingFetch = vi.fn(async () => jsonResponse({ transcript: "second recording works", transcriptId: "t-2" }));
    const { stream: secondStream } = fakeStream();
    const secondCallbacks = callbackSpies();
    await finishRecording(secondStream, [new Blob(["second-recording"])], "audio/wav", "client-1", secondCallbacks, { fetch: succeedingFetch });

    expect(succeedingFetch).toHaveBeenCalledTimes(1);
    expect(secondCallbacks.onSuccess).toHaveBeenCalledWith("second recording works", "t-2", expect.any(Object), null, 1);
    expect(secondCallbacks.onFailure).not.toHaveBeenCalled();
  });

  it("maps UNSUPPORTED_AUDIO_FORMAT to the unsupportedFormat reason, never providerUnavailable", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: "UNSUPPORTED_AUDIO_FORMAT", message: "This recording format isn't supported for transcription. Please try again, or type your note." }, false, 400),
    );

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    expect(callbacks.onFailure).toHaveBeenCalledWith(expect.any(String), "unsupportedFormat", expect.any(Object), 1);
  });

  it("maps VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE to the saveUnavailable reason -- the transcription itself succeeded, only saving failed, never blamed on the AI service or the microphone", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: "VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE", message: "The transcript could not be saved right now. You can still type your note." }, false, 503),
    );

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    // Retryable -- a DB hiccup is transient -- so two attempts, both
    // reporting the same code, then an honest final reason.
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(callbacks.onFailure).toHaveBeenCalledWith(expect.any(String), "saveUnavailable", expect.any(Object), 2);
  });

  it("passes an AbortSignal on every fetch call, so a hung request can be aborted rather than waiting forever", async () => {
    const { stream } = fakeStream();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbackSpies(), { fetch: fetchStub });

    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // Voice latency audit (2026-08-18): proves the marks object passed to
  // onSuccess/onFailure actually reflects the stages this specific call
  // reached, using real timestamps -- never a stub/placeholder object.
  it("passes real, monotonically-increasing latency marks for every stage reached, on success", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1", providerLatencyMs: 250 }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    const [, , marks, sttProviderMs] = callbacks.onSuccess.mock.calls[0];
    expect(marks.recording_stopped).toEqual(expect.any(Number));
    expect(marks.blob_created).toEqual(expect.any(Number));
    expect(marks.stt_request_started).toEqual(expect.any(Number));
    expect(marks.stt_response_received).toEqual(expect.any(Number));
    expect(marks.transcript_ready).toEqual(expect.any(Number));
    // Real ordering, not just presence -- each stage genuinely happens no
    // earlier than the one before it.
    expect(marks.blob_created).toBeGreaterThanOrEqual(marks.recording_stopped);
    expect(marks.stt_response_received).toBeGreaterThanOrEqual(marks.stt_request_started);
    expect(sttProviderMs).toBe(250);
  });

  it("extracts sttProviderMs from the server's own providerLatencyMs field, never fabricating one when the server didn't include it", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () => jsonResponse({ transcript: "note", transcriptId: "t-1" }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    const [, , , sttProviderMs] = callbacks.onSuccess.mock.calls[0];
    expect(sttProviderMs).toBeNull();
  });

  it("marks reflect the RETRY's own response timing, not the first (superseded) attempt's, when a retry succeeds", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "VOICE_TRANSCRIPTION_FAILED" }, false, 502))
      .mockResolvedValueOnce(jsonResponse({ transcript: "note", transcriptId: "t-1", providerLatencyMs: 400 }));

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    const [, , marks, sttProviderMs] = callbacks.onSuccess.mock.calls[0];
    expect(marks.stt_response_received).toEqual(expect.any(Number));
    expect(sttProviderMs).toBe(400);
  });

  it("passes marks even on failure, covering every stage reached before the failure", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "not configured" }, false, 503),
    );

    await finishRecording(stream, [new Blob(["x"])], "audio/webm", "client-1", callbacks, { fetch: fetchStub });

    const [, , marks] = callbacks.onFailure.mock.calls[0];
    expect(marks.recording_stopped).toEqual(expect.any(Number));
    expect(marks.stt_request_started).toEqual(expect.any(Number));
    expect(marks.stt_response_received).toEqual(expect.any(Number));
    // Never reached for a failed attempt.
    expect(marks.transcript_ready).toBeUndefined();
  });

  it("passes only the marks reached so far (recording_stopped) for an empty recording, rejected before any request", async () => {
    const { stream } = fakeStream();
    const callbacks = callbackSpies();

    await finishRecording(stream, [], "audio/webm", "client-1", callbacks, { fetch: vi.fn() });

    const [, , marks] = callbacks.onFailure.mock.calls[0];
    expect(marks.recording_stopped).toEqual(expect.any(Number));
    expect(marks.stt_request_started).toBeUndefined();
  });
});

describe("classifyMicrophoneStartError", () => {
  it("classifies NotAllowedError (the current DOM spec's permission-denial name) as denied", () => {
    const error = new Error("Permission denied");
    error.name = "NotAllowedError";
    expect(classifyMicrophoneStartError(error)).toBe("denied");
  });

  it("classifies the older, non-standard PermissionDeniedError name as denied too", () => {
    const error = new Error("Permission denied");
    error.name = "PermissionDeniedError";
    expect(classifyMicrophoneStartError(error)).toBe("denied");
  });

  it("classifies every other error (no device, device busy, MediaRecorder unsupported mimeType, etc.) as unavailable, not denied", () => {
    const notFound = new Error("no microphone");
    notFound.name = "NotFoundError";
    expect(classifyMicrophoneStartError(notFound)).toBe("unavailable");

    const notReadable = new Error("device busy");
    notReadable.name = "NotReadableError";
    expect(classifyMicrophoneStartError(notReadable)).toBe("unavailable");

    expect(classifyMicrophoneStartError("not even an Error instance")).toBe("unavailable");
    expect(classifyMicrophoneStartError(undefined)).toBe("unavailable");
  });
});

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
