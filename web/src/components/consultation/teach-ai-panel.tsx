"use client";

import { Brain, Mic, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Button, Textarea } from "@/components/ui";

type Action = "save_client_memory" | "save_professional_rule" | "mark_preference" | "save_outcome";

export function TeachAiPanel({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [transcriptId, setTranscriptId] = useState<string>();
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string>();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function save(action: Action) {
    if (!draft.trim()) return;
    // The explicit-confirm gate the backend also enforces (confirmed: true
    // below) -- the stylist must actively approve this exact text before it
    // is ever sent, whether it came from typing or a voice transcript.
    if (!window.confirm("Confirm that you want to save this as persistent AI memory?")) return;

    const response = await fetch(`/api/v1/clients/${clientId}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, content: draft.trim(), confirmed: true, transcriptId })
    });

    setStatus(response.ok ? "Saved with provenance and audit history." : "The memory could not be saved.");
    if (response.ok) {
      setDraft("");
      setTranscriptId(undefined);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("Voice recording is not supported here. You can still type your note.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const media = new MediaRecorder(stream);
      recorder.current = media;
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "note.webm");

        const response = await fetch(`/api/v1/clients/${clientId}/voice-transcript`, { method: "POST", body: form });
        const payload = (await response.json()) as { transcript?: string; transcriptId?: string; message?: string };
        if (!response.ok) {
          setStatus(payload.message || "Voice transcription failed. You can still type your note.");
          return;
        }

        setDraft(payload.transcript ?? "");
        setTranscriptId(payload.transcriptId);
        setStatus("Transcript ready for review. It has not been saved as memory.");
      };
      media.start();
      setRecording(true);
      setStatus("Listening...");
    } catch {
      setStatus("Microphone access was not available. You can still type your note.");
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Brain className="h-4 w-4" aria-hidden="true" />
        Teach the AI
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface-alt p-3">
      <div className="mb-2 flex items-center justify-between">
        <strong className="text-sm">Teach the AI</strong>
        <Button type="button" variant="secondary" onClick={toggleRecording}>
          {recording ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
          {recording ? "Stop" : "Speak to AI"}
        </Button>
      </div>
      <Textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setTranscriptId(undefined);
        }}
        rows={3}
        placeholder="Write an observation, a rule, a preference, or an outcome..."
      />
      <p className="my-2 text-xs text-muted">
        Text and transcripts never become facts automatically. Choose an action below and confirm explicitly.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => save("save_client_memory")}>Save to client memory</Button>
        <Button type="button" variant="secondary" onClick={() => save("save_professional_rule")}>Save as professional rule</Button>
        <Button type="button" variant="secondary" onClick={() => save("mark_preference")}>Mark as preference</Button>
        <Button type="button" variant="secondary" onClick={() => save("save_outcome")}>Save outcome</Button>
      </div>
      {status ? (
        <div className="mt-2">
          <Alert>{status}</Alert>
        </div>
      ) : null}
    </div>
  );
}
