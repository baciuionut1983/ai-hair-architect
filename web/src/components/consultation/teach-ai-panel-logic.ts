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

  try {
    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    const form = new FormData();
    form.append("audio", blob, "note.webm");

    const response = await deps.fetch(`/api/v1/clients/${clientId}/voice-transcript`, { method: "POST", body: form });
    const payload = (await response.json()) as { transcript?: string; transcriptId?: string; message?: string };

    if (!response.ok) {
      callbacks.onFailure(payload.message || GENERIC_TRANSCRIPTION_FAILURE_MESSAGE);
      return;
    }

    callbacks.onSuccess(payload.transcript ?? "", payload.transcriptId);
  } catch {
    callbacks.onFailure(GENERIC_TRANSCRIPTION_FAILURE_MESSAGE);
  }
}
