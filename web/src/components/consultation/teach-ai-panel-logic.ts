// Speak to AI's voice-note lifecycle, pulled out of teach-ai-panel.tsx so it
// is unit-testable without a rendering environment (no .test.tsx convention
// exists in this repo -- see analysis-original-photo-logic.ts).
//
// Regression: a live report where, after manually stopping the recorder,
// "Listening..." stayed on screen forever -- no transcript, no processing
// message, no error. Root cause: MediaRecorder's onstop was an async arrow
// function with no try/catch; any failure inside it (a network error, a
// non-ok response, response.json() throwing on a non-JSON body) became a
// silently swallowed unhandled promise rejection, so nothing ever updated
// the UI again. finishRecording is now the single place that both (a)
// always replaces "Listening..." the instant the recorder actually stops
// -- via onStopped, called synchronously before anything async runs, so it
// fires regardless of whether the stop was a manual click or the browser/
// OS ending the track itself -- and (b) wraps the entire transcription
// request in a try/catch so no failure path can ever leave the UI stuck.

export interface VoiceNoteStreamLike {
  getTracks(): { stop(): void }[];
}

export interface FinishRecordingCallbacks {
  onStopped: () => void;
  onFailure: (message: string) => void;
  onSuccess: (transcript: string, transcriptId: string | undefined) => void;
}

export interface FinishRecordingDeps {
  fetch: typeof fetch;
}

const GENERIC_TRANSCRIPTION_FAILURE_MESSAGE = "Voice transcription failed. You can still type your note.";

// Regression: a live report showed this exact generic message with no
// further clue, and -- critically -- Railway's Deploy Logs showed zero
// VOICE_TRANSCRIPT lines at all after reproducing it, meaning the request
// may never have reached the backend's route handler in the first place.
// Without client-side visibility, "fetch threw before ever reaching the
// server" and "server rejected the request" were indistinguishable. These
// logs (safe fields only -- never audio bytes, never transcript text,
// never any token/cookie) let a single browser-console read settle which
// one actually happened.
const CLIENT_LOG_TAG = "VOICE_TRANSCRIPT_CLIENT";

// Exported so teach-ai-panel.tsx can log the one step that happens before
// finishRecording is ever called (recording actually starting) with the
// exact same tag/shape.
export function logClient(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ tag: CLIENT_LOG_TAG, event, ...details }));
}

// Regression: the demonstrated root cause of the live "Voice transcription
// failed" report. `{ fetch }` (object shorthand for `{ fetch: fetch }`)
// stores the bare global function reference as a plain object's property.
// A real browser's native fetch is a *branded* method -- it requires
// `this` to be exactly the window/global object it's defined on. Calling
// it later as `deps.fetch(...)` invokes it with `this === deps` (plain
// method-call syntax always binds `this` to the object before the dot),
// which throws "TypeError: Failed to execute 'fetch' on 'Window': Illegal
// invocation" -- synchronously, before any network request is ever made.
// This was invisible in every test because a mocked fetch (vi.fn()) never
// checks `this` at all; only a real browser's native implementation does.
// bindFetch fixes this at the one place a real fetch reference is ever
// captured, so it works correctly no matter how it's later invoked.
export function bindFetch(nativeFetch: typeof fetch): typeof fetch {
  return nativeFetch.bind(globalThis);
}

export async function finishRecording(
  stream: VoiceNoteStreamLike,
  chunks: Blob[],
  mimeType: string,
  clientId: string,
  callbacks: FinishRecordingCallbacks,
  deps: FinishRecordingDeps,
): Promise<void> {
  stream.getTracks().forEach((track) => track.stop());
  callbacks.onStopped();
  logClient("recording_stopped");

  try {
    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    logClient("blob_created", { mimeType: blob.type, sizeBytes: blob.size });

    const form = new FormData();
    form.append("audio", blob, "note.webm");

    let response: Response;
    try {
      logClient("request_initiated");
      response = await deps.fetch(`/api/v1/clients/${clientId}/voice-transcript`, { method: "POST", body: form });
      logClient("response_received", { status: response.status, ok: response.ok });
    } catch (error) {
      // The exact previously-invisible failure mode: fetch itself throwing
      // (a network error, a CORS/CSP rejection, or the request never
      // leaving the browser at all) means the backend's own VOICE_TRANSCRIPT
      // logging (added separately) can never fire, no matter how thorough
      // it is -- this is the only place that failure is observable.
      logClient("fetch_threw", {
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      callbacks.onFailure(GENERIC_TRANSCRIPTION_FAILURE_MESSAGE);
      return;
    }

    let payload: { transcript?: string; transcriptId?: string; message?: string };
    try {
      payload = await response.json();
    } catch (error) {
      // Distinct from fetch_threw: the request DID reach some server (a
      // response with a real status came back), but its body wasn't valid
      // JSON -- e.g. an HTML error page from an edge/proxy layer in front
      // of the Next.js app, never the app's own route handler at all.
      logClient("response_json_parse_threw", {
        status: response.status,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      callbacks.onFailure(GENERIC_TRANSCRIPTION_FAILURE_MESSAGE);
      return;
    }

    if (!response.ok) {
      logClient("response_not_ok", { status: response.status, hasMessage: Boolean(payload.message) });
      callbacks.onFailure(payload.message || GENERIC_TRANSCRIPTION_FAILURE_MESSAGE);
      return;
    }

    logClient("success", { transcriptLength: (payload.transcript ?? "").length });
    callbacks.onSuccess(payload.transcript ?? "", payload.transcriptId);
  } catch (error) {
    // Defensive catch-all preserving the original fix's own guarantee:
    // nothing here can ever leave the UI stuck on "Listening...", even an
    // unexpected failure in Blob/FormData construction itself.
    logClient("unexpected_error", {
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    callbacks.onFailure(GENERIC_TRANSCRIPTION_FAILURE_MESSAGE);
  }
}
