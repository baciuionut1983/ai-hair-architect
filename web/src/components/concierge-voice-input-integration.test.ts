import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// AI Concierge V1 -- Voice Input Integration. Source-level structural
// proofs for the architectural properties this task requires but that
// this codebase's own conventions (no jsdom/testing-library -- see
// vitest.config.ts) cannot assert by actually rendering React components
// or calling hooks. Mirrors this codebase's own established precedent for
// exactly this situation (e.g. orchestrator-service.test.ts's own
// "source-level lock: orchestrator-service.ts never references any Video/
// Photo Preview create/submit/execute function", and Production Fix #2's
// own "source-level lock: the workflow-memory Provider is mounted...").
//
// What this DOES prove: the real source code has the shape the task
// requires (one submit path, no parallel voice-specific orchestrator, no
// direct engine/paid-call references, the same language source reused).
// What this does NOT prove: the literal browser behavior of clicking the
// mic and speaking -- that is what the next real production voice test
// confirms, exactly like Production Fix #1/#2's own input-clearing and
// cross-navigation proofs.

function readSource(...segments: string[]): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dirname, ...segments), "utf8");
}

describe("Voice Input Integration -- structural proofs", () => {
  it("no parallel voice-specific orchestrator/decision path exists anywhere in the Concierge surface", () => {
    // Task's own explicit prohibition: askVoice()/voiceOrchestrate()/
    // voiceAction() or any other second decision path.
    const files = ["concierge-panel.tsx", "concierge-voice-input.tsx", "use-concierge.ts", "concierge-logic.ts"];
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/askVoice/);
      expect(source).not.toMatch(/voiceOrchestrate/);
      expect(source).not.toMatch(/voiceAction/);
    }
  });

  it("the voice transcript handler and the typed submit handler both call the SAME submitMessage function, not two independent ones", () => {
    const source = readSource("concierge-panel.tsx");
    // handleSubmit and handleVoiceTranscript both exist, and BOTH call
    // submitMessage(...) -- the one and only place ask() is ever invoked
    // from this component.
    expect(source).toMatch(/function handleSubmit\(/);
    expect(source).toMatch(/function handleVoiceTranscript\(/);
    expect(source.match(/submitMessage\(/g)?.length).toBe(3); // definition + 2 call sites
    // ask() is only ever really INVOKED (not just mentioned in a doc
    // comment) from inside submitMessage -- the literal `void ask(` call
    // expression appears exactly once in the whole component.
    expect(source.match(/void ask\(/g)?.length).toBe(1);
  });

  it("ConciergeVoiceInput never imports fetch/orchestrate/engine submission code directly -- it only ever reaches the server through the onTranscript callback prop", () => {
    const source = readSource("concierge-voice-input.tsx");
    expect(source).not.toMatch(/\/api\/v1\/concierge\/orchestrate/);
    expect(source).not.toMatch(/resolveOrchestratorDecision/);
    // No Video/Photo Preview/paid-engine reference of any kind.
    expect(source).not.toMatch(/generateVideos/);
    expect(source).not.toMatch(/createVideoDemonstrationGeneration/);
    expect(source).not.toMatch(/createPhotoPreviewGeneration/);
    expect(source).not.toMatch(/executeVideoDemonstrationGeneration/);
    expect(source).not.toMatch(/executePhotoPreviewGeneration/);
    expect(source).not.toMatch(/Veo/);
  });

  it("ConciergeVoiceInput never invents/passes a fake or hardcoded client id -- it only ever forwards the caller-supplied activeClientId", () => {
    const source = readSource("concierge-voice-input.tsx");
    // No literal string is ever assigned where a real client id is
    // expected -- clientId only ever comes from the `activeClientId`/
    // `clientId` prop this component received, never a locally-invented
    // value.
    expect(source).not.toMatch(/clientId:\s*["'`]/);
    expect(source).not.toMatch(/clientId\s*=\s*["'`]/);
    // The closed hook is called with the SAME prop this component
    // received, never a locally-computed/derived id.
    expect(source).toMatch(/useVoiceRecording\(\{\s*\n?\s*clientId,/);
  });

  it("reuses the EXISTING closed useVoiceRecording hook -- never duplicates a real MediaRecorder/getUserMedia/AudioContext call", () => {
    const source = readSource("concierge-voice-input.tsx");
    expect(source).toMatch(/from ["']\.\/consultation\/use-voice-recording["']/);
    // Real invocations/instantiations (not merely the words appearing in
    // documentation prose, which legitimately explains what this file does
    // NOT duplicate) -- none of these exist here, because none of this
    // file's code ever needs to touch them; useVoiceRecording owns all of
    // it, unmodified.
    expect(source).not.toMatch(/new MediaRecorder\(/);
    expect(source).not.toMatch(/getUserMedia\(/);
    expect(source).not.toMatch(/new AudioContext\(/);
    expect(source).not.toMatch(/evaluateVadSample\(/);
  });

  it("uses Concierge's own existing global language selection -- never a second, independent language selector", () => {
    const voiceSource = readSource("concierge-voice-input.tsx");
    const panelSource = readSource("concierge-panel.tsx");
    // concierge-voice-input.tsx takes `language` as a plain prop, never
    // reads its own storage key or a separate selection type.
    expect(voiceSource).not.toMatch(/LanguageSelection/);
    expect(voiceSource).not.toMatch(/LANGUAGE_SELECTION_STORAGE_KEY/);
    expect(voiceSource).not.toMatch(/localStorage/);
    expect(voiceSource).not.toMatch(/sessionStorage/);
    // concierge-panel.tsx passes the SAME `language` useUiLanguage()
    // already resolves for every other piece of Concierge copy.
    expect(panelSource).toMatch(/const \{ t, language \} = useUiLanguage\(\)/);
    expect(panelSource).toMatch(/<ConciergeVoiceInput[^>]*language=\{language\}/);
  });

  it("microphone/STT failure cannot reach Concierge state -- the only bridge out of this component is the closed hook's own onTranscript, never a locally-added error/failure branch", () => {
    const source = readSource("concierge-voice-input.tsx");
    // This component never reaches into the closed hook's own internal
    // failure/no-speech callbacks (finishRecording's own
    // onFailure/onNoSpeechDetected, teach-ai-panel-logic.ts) -- it only
    // ever consumes useVoiceRecording's already-filtered public result
    // (recording/processing/error/toggleRecording), so a failure can only
    // ever surface as the hook's own translated `error` string, displayed,
    // never routed into onTranscript or any Concierge state change.
    expect(source).not.toMatch(/onFailure/);
    expect(source).not.toMatch(/onNoSpeechDetected/);
    // The prop this component forwards outward is named onTranscript, and
    // its only caller-side handler in concierge-panel.tsx
    // (handleVoiceTranscript) is never also referenced from an error path.
    const panelSource = readSource("concierge-panel.tsx");
    // definition + its one JSX wiring (`onTranscript={handleVoiceTranscript}`)
    // -- a third, doc-comment-only mention is expected and fine; what
    // matters is there is exactly one REAL wiring, via the literal JSX
    // attribute form.
    expect(panelSource.match(/onTranscript=\{handleVoiceTranscript\}/g)?.length).toBe(1);
  });

  it("TTS response integration was NOT wired in this task -- no voice-reply/TTS call site exists in the Concierge surface", () => {
    const files = ["concierge-panel.tsx", "concierge-voice-input.tsx", "use-concierge.ts"];
    for (const file of files) {
      const source = readSource(file);
      expect(source).not.toMatch(/voice-reply/);
      expect(source).not.toMatch(/speakReply/);
      expect(source).not.toMatch(/synthesizeCloudVoiceReply/);
    }
  });
});
