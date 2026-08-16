// The network half of cloud Voice Reply -- calling POST
// /api/v1/clients/{id}/voice-reply and turning its response into either a
// playable audio Blob or a classified failure reason. Pulled out of
// consultation-chat.tsx for the same reason teach-ai-panel-logic.ts's
// finishRecording is separate from use-voice-recording.ts's MediaRecorder
// wiring: this half is pure enough to unit-test with a mocked fetch (no
// .test.tsx convention exists in this repo), while the actual Audio-
// element/object-URL playback mechanics are DOM-only and stay in the
// component, exactly like MediaRecorder's own wiring does.
//
// This never generates a second, separately-worded reply -- callers must
// pass the EXACT text already shown in the message bubble; this function
// only ever forwards it.

import type { LanguageCode } from "@/lib/language-registry";

export type CloudVoiceReplyFailureReason = "network" | "unavailable";

export interface SynthesizeCloudVoiceReplyDeps {
  fetch: typeof fetch;
}

export interface SynthesizeCloudVoiceReplyCallbacks {
  onSuccess: (audioBlob: Blob) => void;
  // "network": the request never completed (fetch threw -- offline, CORS,
  // the request never left the browser). "unavailable": a real HTTP
  // response came back, but not 2xx (provider not configured, rate
  // limited, timed out server-side, unsupported language, etc.) -- the
  // route's own JSON message already describes the specifics server-side
  // (see voice-reply/route.ts's VOICE_REPLY log gate); this function only
  // needs to know "cloud didn't work, fall back" for either case.
  onFailure: (reason: CloudVoiceReplyFailureReason) => void;
}

export async function synthesizeCloudVoiceReply(
  clientId: string,
  text: string,
  language: LanguageCode,
  deps: SynthesizeCloudVoiceReplyDeps,
  callbacks: SynthesizeCloudVoiceReplyCallbacks,
): Promise<void> {
  let response: Response;
  try {
    response = await deps.fetch(`/api/v1/clients/${clientId}/voice-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    });
  } catch {
    callbacks.onFailure("network");
    return;
  }

  if (!response.ok) {
    callbacks.onFailure("unavailable");
    return;
  }

  try {
    const blob = await response.blob();
    callbacks.onSuccess(blob);
  } catch {
    callbacks.onFailure("unavailable");
  }
}
