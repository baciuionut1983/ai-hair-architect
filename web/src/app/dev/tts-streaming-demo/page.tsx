"use client";

// TTS streaming demo (DEV-ONLY, NOT linked from any navigation/layout/
// menu -- reachable only by typing this URL directly, with a real
// ?clientId=... query param). Lets a human trigger and listen to both
// arms of the TRUE-streaming-vs-buffer-then-play experiment side by
// side: CONTROL calls the existing, production, full-WAV
// /api/v1/clients/{id}/voice-reply endpoint unchanged; CANDIDATE calls
// the new, experimental, streaming /api/v1/clients/{id}/voice-reply-stream
// endpoint (see that route's own module doc comment -- it is a true
// no-op unless TEXT_TO_SPEECH_STREAMING_MODEL is explicitly set).
//
// Deliberately self-contained: writes its own small fetch calls rather
// than importing consultation-chat-cloud-tts-logic.ts (which is on the
// do-not-modify list and, more importantly, is wired into the real
// consultation UI's own state/callback shape -- this page only needs the
// same request shape, not that file's production wiring).

import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { createGaplessPcmStreamPlayer } from "@/lib/tts-streaming-playback-logic";

// Verbatim copy of ROMANIAN_MEDIUM from scripts/tts-streaming-latency-harness.ts
// (itself copied verbatim from tts-ab-latency-harness.ts's own
// ROMANIAN_SAMPLE) -- never paraphrased or regenerated.
const ROMANIAN_MEDIUM_SAMPLE =
  "Bună! Pentru părul tău ondulat și des, recomand un tuns în straturi care să reducă volumul și să pună în evidență buclele naturale. Îți sugerez să folosești un balsam fără sulfați și să eviți periajul pe păr uscat, pentru a preveni frizul.";

// Chunks arriving from the network are typically far smaller than this
// (the real streaming provider's own chunks were confirmed live at
// ~1920 bytes) -- accumulating a few of them before each scheduleChunk
// call avoids scheduling a large number of very tiny AudioBufferSourceNodes.
const MIN_SCHEDULE_BYTES = 4096;
const STREAMING_SAMPLE_RATE_HZ = 24000;

type LanguageOption = "ro" | "en";

function TtsStreamingDemoContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId");

  const [text, setText] = useState(ROMANIAN_MEDIUM_SAMPLE);
  const [language, setLanguage] = useState<LanguageOption>("ro");

  const [controlBusy, setControlBusy] = useState(false);
  const [controlTimeMs, setControlTimeMs] = useState<number | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const controlAudioRef = useRef<HTMLAudioElement | null>(null);

  const [candidateBusy, setCandidateBusy] = useState(false);
  const [candidateFirstScheduledMs, setCandidateFirstScheduledMs] = useState<number | null>(null);
  const [candidateChunkCount, setCandidateChunkCount] = useState(0);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidateNotConfigured, setCandidateNotConfigured] = useState(false);

  if (!clientId) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <p>Append ?clientId=&lt;a real client id from your account&gt; to use this page.</p>
      </div>
    );
  }

  async function playControl() {
    setControlBusy(true);
    setControlError(null);
    setControlTimeMs(null);
    const clickedAt = performance.now();

    try {
      const response = await fetch(`/api/v1/clients/${clientId}/voice-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}) as { error?: string; message?: string });
        setControlError(`CONTROL failed: HTTP ${response.status} ${errorBody.error ?? ""} ${errorBody.message ?? ""}`.trim());
        return;
      }

      const bytes = await response.arrayBuffer();
      const blob = new Blob([bytes], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      const audio = controlAudioRef.current;
      if (!audio) return;
      audio.src = url;
      const onPlaying = () => {
        setControlTimeMs(performance.now() - clickedAt);
        audio.removeEventListener("playing", onPlaying);
      };
      audio.addEventListener("playing", onPlaying);
      await audio.play();
    } catch (error) {
      setControlError(`CONTROL error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setControlBusy(false);
    }
  }

  async function playCandidate() {
    setCandidateBusy(true);
    setCandidateError(null);
    setCandidateNotConfigured(false);
    setCandidateFirstScheduledMs(null);
    setCandidateChunkCount(0);
    const clickedAt = performance.now();

    try {
      const response = await fetch(`/api/v1/clients/${clientId}/voice-reply-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      });

      if (response.status === 503) {
        setCandidateNotConfigured(true);
        return;
      }
      if (!response.ok || !response.body) {
        const errorBody = await response.json().catch(() => ({}) as { error?: string; message?: string });
        setCandidateError(`CANDIDATE failed: HTTP ${response.status} ${errorBody.error ?? ""} ${errorBody.message ?? ""}`.trim());
        return;
      }

      const audioContext = new AudioContext();
      const player = createGaplessPcmStreamPlayer(audioContext, STREAMING_SAMPLE_RATE_HZ);
      const reader = response.body.getReader();

      let pending: Uint8Array[] = [];
      let pendingBytes = 0;
      let firstScheduled = false;
      let chunkCount = 0;

      const flush = (flushRemaining: boolean) => {
        if (pendingBytes === 0) return;
        if (!flushRemaining && pendingBytes < MIN_SCHEDULE_BYTES) return;

        const combined = new Uint8Array(pendingBytes);
        let offset = 0;
        for (const part of pending) {
          combined.set(part, offset);
          offset += part.length;
        }
        pending = [];
        pendingBytes = 0;

        player.scheduleChunk(combined.buffer);
        chunkCount += 1;
        setCandidateChunkCount(chunkCount);
        if (!firstScheduled) {
          firstScheduled = true;
          setCandidateFirstScheduledMs(performance.now() - clickedAt);
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (value) {
          pending.push(value);
          pendingBytes += value.length;
          flush(false);
        }
        if (done) {
          flush(true);
          break;
        }
      }
    } catch (error) {
      setCandidateError(`CANDIDATE error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCandidateBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 720 }}>
      <h1>TTS Streaming Demo (dev-only)</h1>
      <p style={{ color: "#666" }}>
        Not linked from any menu. Client: <code>{clientId}</code>
      </p>

      <label style={{ display: "block", marginTop: 16 }}>
        Text
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          style={{ display: "block", width: "100%", marginTop: 4 }}
        />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        Language{" "}
        <select value={language} onChange={(event) => setLanguage(event.target.value as LanguageOption)}>
          <option value="ro">Romanian (ro)</option>
          <option value="en">English (en)</option>
        </select>
      </label>

      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <button type="button" onClick={() => void playControl()} disabled={controlBusy}>
          {controlBusy ? "Playing CONTROL..." : "Play CONTROL (full WAV)"}
        </button>
        <button type="button" onClick={() => void playCandidate()} disabled={candidateBusy}>
          {candidateBusy ? "Playing CANDIDATE..." : "Play CANDIDATE (streaming)"}
        </button>
      </div>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16 }}>CONTROL (existing, non-streaming voice-reply)</h2>
        {controlTimeMs !== null ? <p>Time to audio ready: {Math.round(controlTimeMs)}ms</p> : null}
        {controlError ? <p style={{ color: "crimson" }}>{controlError}</p> : null}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={controlAudioRef} controls style={{ width: "100%" }} />
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16 }}>CANDIDATE (new, experimental voice-reply-stream)</h2>
        {candidateNotConfigured ? (
          <p>
            Streaming voice reply is not enabled in this environment (TEXT_TO_SPEECH_STREAMING_MODEL is unset) -- this is expected everywhere it
            hasn&apos;t been explicitly turned on.
          </p>
        ) : (
          <>
            {candidateFirstScheduledMs !== null ? <p>Time to FIRST audio scheduled: {Math.round(candidateFirstScheduledMs)}ms</p> : null}
            <p>Chunks received: {candidateChunkCount}</p>
            {candidateError ? <p style={{ color: "crimson" }}>{candidateError}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}

export default function TtsStreamingDemoPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <TtsStreamingDemoContent />
    </Suspense>
  );
}
