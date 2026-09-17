import { describe, expect, it } from "vitest";

import { buildProfessionalLearningVideoMetadataDiagnostic } from "@/lib/professional-learning-video-metadata-diagnostic";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.3.R2 -- pure
// tests, zero I/O, zero real Gemini calls. Proves the sanitizer emits
// ONLY safe structural information about Gemini's real File.
// videoMetadata shape, never a raw sensitive value.

describe("buildProfessionalLearningVideoMetadataDiagnostic", () => {
  it("1. videoMetadata absent -> safe diagnostic says absent", () => {
    expect(buildProfessionalLearningVideoMetadataDiagnostic(undefined)).toEqual({ present: false, keys: [], types: {}, candidateDuration: null });
    expect(buildProfessionalLearningVideoMetadataDiagnostic(null)).toEqual({ present: false, keys: [], types: {}, candidateDuration: null });
  });

  it("2. videoMetadata empty -> safe empty structure", () => {
    expect(buildProfessionalLearningVideoMetadataDiagnostic({})).toEqual({ present: true, keys: [], types: {}, candidateDuration: null });
  });

  it("3. primitive keys -> key names/types reported, no candidate for non-duration-like names", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ fps: 30, codec: "h264" });
    expect(result.present).toBe(true);
    expect([...result.keys].sort()).toEqual(["codec", "fps"]);
    expect(result.types).toEqual({ fps: "number", codec: "string" });
    expect(result.candidateDuration).toBeNull();
  });

  it("4. duration-like primitive string -> candidate key/type/value reported", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ videoDuration: "67.601s" });
    expect(result.candidateDuration).toEqual({ field: "videoDuration", type: "string", value: "67.601s" });
  });

  it("5. duration-like primitive number -> candidate key/type/value reported", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ durationSeconds: 67.6 });
    expect(result.candidateDuration).toEqual({ field: "durationSeconds", type: "number", value: 67.6 });
  });

  it("6. unrelated arbitrary string value -> value NOT logged (only key/type)", () => {
    const longUnrelated = "a".repeat(500);
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ codec: longUnrelated });
    expect(result.types.codec).toBe("string");
    expect(JSON.stringify(result)).not.toContain(longUnrelated);
    expect(result.candidateDuration).toBeNull();
  });

  it("7. nested object -> type reported, raw object NOT logged", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ duration: { seconds: 67, nanos: 601000000 } });
    expect(result.types.duration).toBe("object");
    expect(result.candidateDuration).toBeNull();
    expect(JSON.stringify(result)).not.toContain("601000000");
    expect(JSON.stringify(result)).not.toContain("nanos");
  });

  it("8. array -> type reported as array, raw contents NOT logged", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ frameTimestamps: [1, 2, 3, "sensitive-marker"] });
    expect(result.types.frameTimestamps).toBe("array");
    expect(JSON.stringify(result)).not.toContain("sensitive-marker");
  });

  it("9. URI-like field -> value NOT logged even when the name also matches duration-like terms", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ durationUri: "https://files.example/secret-object-42" });
    expect(result.types.durationUri).toBe("string");
    expect(result.candidateDuration).toBeNull();
    expect(JSON.stringify(result)).not.toContain("secret-object-42");
  });

  it("10. token/key/secret-like field -> value NOT logged even when the name also matches duration-like terms", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ timeToken: "abc123supersecret" });
    expect(result.types.timeToken).toBe("string");
    expect(result.candidateDuration).toBeNull();
    expect(JSON.stringify(result)).not.toContain("abc123supersecret");
  });

  it("11. filename/path/storage-like field -> value NOT logged (by name, and independently by value shape)", () => {
    const byName = buildProfessionalLearningVideoMetadataDiagnostic({ durationFile: "clip-duration.txt" });
    expect(byName.candidateDuration).toBeNull();
    expect(JSON.stringify(byName)).not.toContain("clip-duration.txt");

    const byValueShape = buildProfessionalLearningVideoMetadataDiagnostic({ length: "/var/data/clip.mp4" });
    expect(byValueShape.candidateDuration).toBeNull();
    expect(JSON.stringify(byValueShape)).not.toContain("/var/data/clip.mp4");
  });

  it("12. unknown arbitrary metadata -> keys/types only, mixed shapes", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({
      resolution: "1920x1080",
      rotation: 0,
      hasAudio: true,
      chapters: [{ start: 0 }],
    });
    expect(result.present).toBe(true);
    expect(result.types).toEqual({ resolution: "string", rotation: "number", hasAudio: "boolean", chapters: "array" });
    expect(result.candidateDuration).toBeNull();
    expect(JSON.stringify(result)).not.toContain("1920x1080");
  });

  it("reports only the FIRST matching candidate, deterministically, never overwritten by a second", () => {
    const result = buildProfessionalLearningVideoMetadataDiagnostic({ duration: "67.601s", videoDurationSeconds: 67.6 });
    expect(result.candidateDuration).toEqual({ field: "duration", type: "string", value: "67.601s" });
  });

  it("an empty or excessively long duration-like string is never emitted as a candidate value", () => {
    const empty = buildProfessionalLearningVideoMetadataDiagnostic({ duration: "" });
    expect(empty.candidateDuration).toBeNull();

    const tooLong = buildProfessionalLearningVideoMetadataDiagnostic({ duration: "6".repeat(30) + "s" });
    expect(tooLong.candidateDuration).toBeNull();
  });
});
