import { describe, expect, it } from "vitest";

import { classifyOrchestratorIntent } from "@/lib/orchestrator-intent-classifier";

describe("classifyOrchestratorIntent -- Stage 1's deterministic classifier", () => {
  it("classifies video-related phrases (EN + RO) as request_video", () => {
    expect(classifyOrchestratorIntent("prepare a video")).toBe("request_video");
    expect(classifyOrchestratorIntent("Vreau un video cu rezultatul")).toBe("request_video");
    expect(classifyOrchestratorIntent("can I get a demonstration clip")).toBe("request_video");
  });

  it("classifies result/preview phrases (EN + RO) as open_analysis", () => {
    expect(classifyOrchestratorIntent("show me the expected result")).toBe("open_analysis");
    expect(classifyOrchestratorIntent("Vreau să văd rezultatul acestei propuneri.")).toBe("open_analysis");
    expect(classifyOrchestratorIntent("let's see the proposed look")).toBe("open_analysis");
  });

  it("classifies 'continue' + consultation/analysis phrases as open_analysis", () => {
    expect(classifyOrchestratorIntent("continue an existing consultation")).toBe("open_analysis");
    expect(classifyOrchestratorIntent("vreau să continui analiza clientei")).toBe("open_analysis");
  });

  it("classifies analyze/haircut/color/styling phrases (EN + RO) as start_analysis", () => {
    expect(classifyOrchestratorIntent("analyze this client")).toBe("start_analysis");
    expect(classifyOrchestratorIntent("work on haircut")).toBe("start_analysis");
    expect(classifyOrchestratorIntent("let's talk about color")).toBe("start_analysis");
    expect(classifyOrchestratorIntent("styling ideas please")).toBe("start_analysis");
    expect(classifyOrchestratorIntent("analizează această clientă")).toBe("start_analysis");
    expect(classifyOrchestratorIntent("vreau să lucrez la tunsoare")).toBe("start_analysis");
  });

  it("classifies a bare mention of 'client' as open_clients", () => {
    expect(classifyOrchestratorIntent("find a client")).toBe("open_clients");
    expect(classifyOrchestratorIntent("open client")).toBe("open_clients");
    expect(classifyOrchestratorIntent("găsește clientul meu")).toBe("open_clients");
  });

  it("falls back to unsupported for an unrecognized goal -- fails honestly rather than guessing", () => {
    expect(classifyOrchestratorIntent("what's the weather today")).toBe("unsupported");
    expect(classifyOrchestratorIntent("book me a flight to paris")).toBe("unsupported");
    expect(classifyOrchestratorIntent("")).toBe("unsupported");
  });

  it("video takes priority over a result/preview phrase mentioned in the same message", () => {
    expect(classifyOrchestratorIntent("show me the expected result as a video")).toBe("request_video");
  });

  it("is case-insensitive", () => {
    expect(classifyOrchestratorIntent("PREPARE A VIDEO")).toBe("request_video");
    expect(classifyOrchestratorIntent("Analyze This Client")).toBe("start_analysis");
  });
});
