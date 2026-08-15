import { describe, expect, it, vi } from "vitest";

import { finishRecording, type VoiceNoteStreamLike } from "./teach-ai-panel-logic";

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
