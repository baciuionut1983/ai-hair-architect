// TTS TRUE-STREAMING latency measurement harness (DEV-ONLY, standalone).
//
// WHAT THIS IS: a manually-run measurement script, sibling to (and
// completely independent of -- neither modifies nor is imported by)
// scripts/tts-ab-latency-harness.ts. That script compares two whole-
// response synthesize() calls against each other (model A vs. model B,
// both buffer-then-play). THIS script instead compares ARCHITECTURE:
// CONTROL is the existing, production, non-streaming
// GeminiTtsProvider.synthesize() call (tts-provider-gemini.ts, imported
// directly, never reimplemented); CANDIDATE is the NEW
// GeminiTtsStreamingProvider.synthesizeStream() call
// (tts-provider-gemini-streaming.ts) -- real incremental audio chunks,
// not a single buffered response. Same models stay each arm's own
// default; this is not a model-swap experiment.
//
// WHY IT EXISTS: this round's own real research already confirmed,
// empirically, that ai.models.generateContentStream with model
// 'gemini-3.1-flash-tts-preview' yields real incremental PCM chunks
// (first chunk in ~1s) where the production model
// ('gemini-2.5-flash-preview-tts') does not stream meaningfully at all
// through the same API. This script is the repeatable, side-by-side tool
// to reproduce and quantify that gap -- time-to-first-audio (the number
// that actually matters for a stylist waiting to hear a reply) versus
// total generation time, plus real audio files for a human to listen to
// and confirm quality wasn't traded away for speed.
//
// COST WARNING: every synthesize()/synthesizeStream() call this script
// makes is a REAL, BILLED Gemini TTS API call -- there is no mock/dry-run
// mode. Each full run performs, per sample text: 1 untimed warm-up +
// `repeats` timed calls, for BOTH arms (control + candidate) -- with 4
// fixed sample texts, that's 4 x 2 x (1 + repeats) real billed calls. Do
// not run this carelessly or repeatedly; a large --repeats value
// multiplies real cost accordingly.
//
// HOW TO RUN (from inside the web/ directory, with a real API key -- this
// script never invents, hardcodes, or falls back to one):
//
//   TEXT_TO_SPEECH_API_KEY=your-real-key npx tsx scripts/tts-streaming-latency-harness.ts --repeats 3
//
// (On Windows PowerShell, set the env var first instead of inlining it:
//   $env:TEXT_TO_SPEECH_API_KEY = "your-real-key"
//   npx tsx scripts/tts-streaming-latency-harness.ts --repeats 3
// )
//
// Optional flags (all have defaults -- see DEFAULT_* below):
//   --control-model <model>    CONTROL (non-streaming) arm's model id
//   --streaming-model <model>  CANDIDATE (streaming) arm's model id
//   --repeats <n>              timed calls per (arm, sample) group
//   --out <dir>                output directory for .wav files + results.json
//
// SCOPE / SAFETY: makes NO change whatsoever to any production code path,
// default model, or live user traffic. It is not imported by, and does
// not import from, anything under src/app or src/components (other than
// the plain library modules it reuses read-only). It only ever READS
// process.env.TEXT_TO_SPEECH_API_KEY and calls the real Gemini API with
// models chosen by its own CLI flags -- it never reads or writes
// TEXT_TO_SPEECH_MODEL, TEXT_TO_SPEECH_STREAMING_MODEL, or any other app
// config. Excluded from the app's own typecheck gate, same as
// tts-ab-latency-harness.ts (see web/tsconfig.json's `exclude`).

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseSampleRateFromMimeType, wrapPcmAsWav } from "../src/lib/tts-audio-format";
import { GeminiTtsProvider, type TtsProviderError } from "../src/lib/tts-provider-gemini";
import { GeminiTtsStreamingProvider } from "../src/lib/tts-provider-gemini-streaming";
import { computeLatencyStats, computeSuccessRate, type LatencyOutcome } from "../src/lib/tts-latency-stats";

const DEFAULT_CONTROL_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_STREAMING_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_REPEATS = 3;
const DEFAULT_OUT_DIR = "./tts-streaming-results";

type SampleLanguage = "ro" | "en";

interface SampleText {
  label: string;
  language: SampleLanguage;
  languageCode: string;
  text: string;
}

// Fixed, deliberately NOT configurable sample texts -- consistency across
// runs/arms is the entire point of this comparison. ROMANIAN_MEDIUM and
// ENGLISH_MEDIUM are copied VERBATIM from tts-ab-latency-harness.ts's own
// ROMANIAN_SAMPLE/ENGLISH_SAMPLE -- never paraphrased or regenerated.
const ROMANIAN_SHORT = "Bună! Părul tău arată foarte bine astăzi.";
const ROMANIAN_MEDIUM =
  "Bună! Pentru părul tău ondulat și des, recomand un tuns în straturi care să reducă volumul și să pună în evidență buclele naturale. Îți sugerez să folosești un balsam fără sulfați și să eviți periajul pe păr uscat, pentru a preveni frizul.";
const ENGLISH_SHORT = "Hi! Your hair looks great today.";
const ENGLISH_MEDIUM =
  "Hi! Based on your hair texture and the photo you shared, I would recommend a layered cut to reduce bulk while keeping length. A leave-in conditioner with light hold would help control frizz without weighing your curls down.";

const SAMPLE_TEXTS: SampleText[] = [
  { label: "romanian_short", language: "ro", languageCode: "ro", text: ROMANIAN_SHORT },
  { label: "romanian_medium", language: "ro", languageCode: "ro", text: ROMANIAN_MEDIUM },
  { label: "english_short", language: "en", languageCode: "en", text: ENGLISH_SHORT },
  { label: "english_medium", language: "en", languageCode: "en", text: ENGLISH_MEDIUM },
];

interface CliOptions {
  controlModel: string;
  streamingModel: string;
  repeats: number;
  outDir: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    controlModel: DEFAULT_CONTROL_MODEL,
    streamingModel: DEFAULT_STREAMING_MODEL,
    repeats: DEFAULT_REPEATS,
    outDir: DEFAULT_OUT_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === "--control-model" && typeof value === "string") {
      options.controlModel = value;
      i += 1;
    } else if (flag === "--streaming-model" && typeof value === "string") {
      options.streamingModel = value;
      i += 1;
    } else if (flag === "--repeats" && typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.repeats = parsed;
      } else {
        console.error(`[tts-streaming-latency-harness] Ignoring invalid --repeats value "${value}" (must be a positive integer); using ${options.repeats}.`);
      }
      i += 1;
    } else if (flag === "--out" && typeof value === "string") {
      options.outDir = value;
      i += 1;
    }
  }

  return options;
}

interface ControlAttemptRecord {
  arm: "control";
  sampleLabel: string;
  language: SampleLanguage;
  attemptNumber: number;
  outcome: LatencyOutcome;
  // For CONTROL, there is no meaningful "first chunk" -- a single
  // buffered response arrives all at once. totalMs is recorded ONCE and
  // reused as both timeToFirstAudioMs and totalTtsGenerationMs in the
  // group summary below: these two numbers are IDENTICAL BY CONSTRUCTION
  // for this arm, never two separately-fabricated numbers.
  totalMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  outputFile: string | null;
}

interface CandidateAttemptRecord {
  arm: "candidate";
  sampleLabel: string;
  language: SampleLanguage;
  attemptNumber: number;
  outcome: LatencyOutcome;
  // null only when the stream failed before a single chunk ever arrived
  // -- never fabricated.
  timeToFirstChunkMs: number | null;
  totalStreamMs: number;
  chunkCount: number;
  interChunkGapsMs: number[];
  errorCode: string | null;
  errorMessage: string | null;
  outputFile: string | null;
}

type AttemptRecord = ControlAttemptRecord | CandidateAttemptRecord;

interface GroupSummary {
  arm: "control" | "candidate";
  sampleLabel: string;
  language: SampleLanguage;
  sampleCount: number;
  successRate: number;
  timeToFirstAudioMedianMs: number | null;
  timeToFirstAudioP95Ms: number | null;
  timeToFirstAudioMinMs: number | null;
  timeToFirstAudioMaxMs: number | null;
  totalTtsGenerationMedianMs: number;
  totalTtsGenerationP95Ms: number | null;
  interChunkGapMedianMs: number | null;
  interChunkGapMaxMs: number | null;
}

function isTtsProviderError(error: unknown): error is TtsProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function describeError(error: unknown): string {
  if (isTtsProviderError(error)) return `code=${error.code} message=${error.message}`;
  return `non-provider error=${String(error)}`;
}

// ---------------------------------------------------------------------
// CONTROL arm -- the existing, production, non-streaming synthesize().
// ---------------------------------------------------------------------

async function runControlWarmup(provider: GeminiTtsProvider, sample: SampleText): Promise<void> {
  console.log(`[tts-streaming-latency-harness] CONTROL warm-up: sample=${sample.label} ...`);
  try {
    await provider.synthesize(sample.text, sample.languageCode);
    console.log(`[tts-streaming-latency-harness] CONTROL warm-up succeeded: sample=${sample.label}`);
  } catch (error) {
    console.log(`[tts-streaming-latency-harness] CONTROL warm-up failed (excluded from stats): sample=${sample.label} ${describeError(error)}`);
  }
}

async function runControlAttempt(provider: GeminiTtsProvider, sample: SampleText, attemptNumber: number, outDir: string): Promise<ControlAttemptRecord> {
  const startedAt = Date.now();
  let outcome: LatencyOutcome = "success";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let audioBase64: string | undefined;
  let mimeType: string | undefined;

  try {
    const result = await provider.synthesize(sample.text, sample.languageCode);
    audioBase64 = result.audioBase64;
    mimeType = result.mimeType;
  } catch (error) {
    outcome = "failure";
    if (isTtsProviderError(error)) {
      errorCode = error.code;
      errorMessage = error.message;
    } else {
      errorCode = "UNKNOWN";
      errorMessage = String(error);
    }
  }
  const totalMs = Date.now() - startedAt;

  let outputFile: string | null = null;
  if (outcome === "success" && typeof audioBase64 === "string") {
    const sampleRateHz = parseSampleRateFromMimeType(mimeType);
    const pcm = Buffer.from(audioBase64, "base64");
    const wav = wrapPcmAsWav(pcm, sampleRateHz);
    const fileName = `${sample.label}__control__attempt${attemptNumber}.wav`;
    await writeFile(join(outDir, fileName), wav);
    outputFile = fileName;
  }

  console.log(
    `[tts-streaming-latency-harness] CONTROL attempt ${attemptNumber}/${sample.label}: outcome=${outcome} totalMs=${totalMs}` +
      (errorCode ? ` errorCode=${errorCode} errorMessage=${errorMessage}` : ""),
  );

  return { arm: "control", sampleLabel: sample.label, language: sample.language, attemptNumber, outcome, totalMs, errorCode, errorMessage, outputFile };
}

// ---------------------------------------------------------------------
// CANDIDATE arm -- the new synthesizeStream(), real incremental chunks.
// ---------------------------------------------------------------------

async function runCandidateWarmup(provider: GeminiTtsStreamingProvider, sample: SampleText): Promise<void> {
  console.log(`[tts-streaming-latency-harness] CANDIDATE warm-up: sample=${sample.label} ...`);
  try {
    let chunkCount = 0;
    for await (const _chunk of provider.synthesizeStream(sample.text, sample.languageCode)) {
      chunkCount += 1;
    }
    console.log(`[tts-streaming-latency-harness] CANDIDATE warm-up succeeded: sample=${sample.label} chunkCount=${chunkCount}`);
  } catch (error) {
    console.log(`[tts-streaming-latency-harness] CANDIDATE warm-up failed (excluded from stats): sample=${sample.label} ${describeError(error)}`);
  }
}

async function runCandidateAttempt(
  provider: GeminiTtsStreamingProvider,
  sample: SampleText,
  attemptNumber: number,
  outDir: string,
): Promise<CandidateAttemptRecord> {
  const startedAt = Date.now();
  let outcome: LatencyOutcome = "success";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let timeToFirstChunkMs: number | null = null;
  let chunkCount = 0;
  const interChunkGapsMs: number[] = [];
  let lastChunkAt: number | null = null;
  const pcmChunks: Buffer[] = [];
  let mimeType: string | undefined;

  try {
    for await (const chunk of provider.synthesizeStream(sample.text, sample.languageCode)) {
      const now = Date.now();
      if (chunkCount === 0) {
        timeToFirstChunkMs = now - startedAt;
      } else if (lastChunkAt !== null) {
        interChunkGapsMs.push(now - lastChunkAt);
      }
      lastChunkAt = now;
      chunkCount += 1;
      pcmChunks.push(chunk.pcm);
      mimeType = chunk.mimeType;
    }
  } catch (error) {
    outcome = "failure";
    if (isTtsProviderError(error)) {
      errorCode = error.code;
      errorMessage = error.message;
    } else {
      errorCode = "UNKNOWN";
      errorMessage = String(error);
    }
  }
  const totalStreamMs = Date.now() - startedAt;

  let outputFile: string | null = null;
  if (outcome === "success" && chunkCount > 0) {
    const sampleRateHz = parseSampleRateFromMimeType(mimeType);
    const pcm = Buffer.concat(pcmChunks);
    const wav = wrapPcmAsWav(pcm, sampleRateHz);
    const fileName = `${sample.label}__streaming__attempt${attemptNumber}.wav`;
    await writeFile(join(outDir, fileName), wav);
    outputFile = fileName;
  }

  console.log(
    `[tts-streaming-latency-harness] CANDIDATE attempt ${attemptNumber}/${sample.label}: outcome=${outcome} timeToFirstChunkMs=${timeToFirstChunkMs} totalStreamMs=${totalStreamMs} chunkCount=${chunkCount}` +
      (errorCode ? ` errorCode=${errorCode} errorMessage=${errorMessage}` : ""),
  );

  return {
    arm: "candidate",
    sampleLabel: sample.label,
    language: sample.language,
    attemptNumber,
    outcome,
    timeToFirstChunkMs,
    totalStreamMs,
    chunkCount,
    interChunkGapsMs,
    errorCode,
    errorMessage,
    outputFile,
  };
}

// ---------------------------------------------------------------------
// Aggregation / reporting -- shared by both arms via the same pure
// tts-latency-stats.ts helpers, over the same two metric names
// (timeToFirstAudioMs / totalTtsGenerationMs) regardless of which arm
// produced them.
// ---------------------------------------------------------------------

function summarizeControlGroup(sample: SampleText, attempts: ControlAttemptRecord[]): GroupSummary {
  // Identical by construction (see ControlAttemptRecord's own doc
  // comment): the exact same array feeds both stats computations.
  const stats = computeLatencyStats(attempts.map((attempt) => attempt.totalMs));
  return {
    arm: "control",
    sampleLabel: sample.label,
    language: sample.language,
    sampleCount: attempts.length,
    successRate: computeSuccessRate(attempts.map((attempt) => attempt.outcome)),
    timeToFirstAudioMedianMs: stats.median,
    timeToFirstAudioP95Ms: stats.p95,
    timeToFirstAudioMinMs: stats.min,
    timeToFirstAudioMaxMs: stats.max,
    totalTtsGenerationMedianMs: stats.median,
    totalTtsGenerationP95Ms: stats.p95,
    interChunkGapMedianMs: null,
    interChunkGapMaxMs: null,
  };
}

function summarizeCandidateGroup(sample: SampleText, attempts: CandidateAttemptRecord[]): GroupSummary {
  // totalStreamMs is always a real elapsed duration, success or failure.
  const totalStats = computeLatencyStats(attempts.map((attempt) => attempt.totalStreamMs));

  // timeToFirstChunkMs genuinely does not exist for an attempt that
  // failed before any chunk ever arrived -- never fabricated; only real
  // values feed this computation (see LatencyStats.count in the printed
  // report to see how many of `sampleCount` attempts actually contributed).
  const firstChunkValues = attempts.map((attempt) => attempt.timeToFirstChunkMs).filter((value): value is number => value !== null);
  const firstChunkStats = firstChunkValues.length > 0 ? computeLatencyStats(firstChunkValues) : null;

  const allGaps = attempts.flatMap((attempt) => attempt.interChunkGapsMs);
  const gapStats = allGaps.length > 0 ? computeLatencyStats(allGaps) : null;

  return {
    arm: "candidate",
    sampleLabel: sample.label,
    language: sample.language,
    sampleCount: attempts.length,
    successRate: computeSuccessRate(attempts.map((attempt) => attempt.outcome)),
    timeToFirstAudioMedianMs: firstChunkStats?.median ?? null,
    timeToFirstAudioP95Ms: firstChunkStats?.p95 ?? null,
    timeToFirstAudioMinMs: firstChunkStats?.min ?? null,
    timeToFirstAudioMaxMs: firstChunkStats?.max ?? null,
    totalTtsGenerationMedianMs: totalStats.median,
    totalTtsGenerationP95Ms: totalStats.p95,
    interChunkGapMedianMs: gapStats?.median ?? null,
    interChunkGapMaxMs: gapStats?.max ?? null,
  };
}

function formatMs(value: number | null): string {
  return value === null ? "n/a" : `${value}ms`;
}

function printGroupReport(summary: GroupSummary, comparisonPct: number | null): void {
  console.log("");
  console.log(`=== ${summary.arm.toUpperCase()} / ${summary.sampleLabel} (${summary.language}) ===`);
  console.log(`  samples:                        ${summary.sampleCount}`);
  console.log(`  success rate:                   ${(summary.successRate * 100).toFixed(1)}%`);
  console.log(`  time-to-first-audio median:     ${formatMs(summary.timeToFirstAudioMedianMs)}`);
  console.log(`  time-to-first-audio p95:        ${formatMs(summary.timeToFirstAudioP95Ms)}`);
  console.log(`  time-to-first-audio min/max:    ${formatMs(summary.timeToFirstAudioMinMs)} / ${formatMs(summary.timeToFirstAudioMaxMs)}`);
  if (summary.arm === "control") {
    console.log(`  (CONTROL: time-to-first-audio and total-generation are IDENTICAL BY CONSTRUCTION -- no separate "first chunk" exists for a non-streaming call.)`);
  }
  console.log(`  total generation median:       ${formatMs(summary.totalTtsGenerationMedianMs)}`);
  console.log(`  total generation p95:          ${formatMs(summary.totalTtsGenerationP95Ms)}`);
  if (summary.arm === "candidate") {
    console.log(`  inter-chunk gap median/max:    ${formatMs(summary.interChunkGapMedianMs)} / ${formatMs(summary.interChunkGapMaxMs)}`);
  }
  if (comparisonPct !== null) {
    const direction = comparisonPct < 0 ? "faster" : "slower";
    console.log(`  CANDIDATE vs CONTROL time-to-first-audio: ${comparisonPct >= 0 ? "+" : ""}${comparisonPct.toFixed(1)}% (${direction})`);
  }
}

// ---------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------

async function runSampleGroup(
  apiKey: string,
  sample: SampleText,
  options: CliOptions,
  outDir: string,
): Promise<{ attempts: AttemptRecord[]; controlSummary: GroupSummary; candidateSummary: GroupSummary }> {
  const controlProvider = new GeminiTtsProvider({ apiKey, model: options.controlModel });
  const candidateProvider = new GeminiTtsStreamingProvider({ apiKey, model: options.streamingModel });

  // Strictly sequential throughout -- both within an arm's own repeats
  // and across the two arms -- never Promise.all. Concurrent calls would
  // contend for the same rate limit and corrupt the latency numbers this
  // whole script exists to measure accurately.
  await runControlWarmup(controlProvider, sample);
  const controlAttempts: ControlAttemptRecord[] = [];
  for (let attemptNumber = 1; attemptNumber <= options.repeats; attemptNumber += 1) {
    controlAttempts.push(await runControlAttempt(controlProvider, sample, attemptNumber, outDir));
  }

  await runCandidateWarmup(candidateProvider, sample);
  const candidateAttempts: CandidateAttemptRecord[] = [];
  for (let attemptNumber = 1; attemptNumber <= options.repeats; attemptNumber += 1) {
    candidateAttempts.push(await runCandidateAttempt(candidateProvider, sample, attemptNumber, outDir));
  }

  return {
    attempts: [...controlAttempts, ...candidateAttempts],
    controlSummary: summarizeControlGroup(sample, controlAttempts),
    candidateSummary: summarizeCandidateGroup(sample, candidateAttempts),
  };
}

function getApiKeyOrExit(): string {
  const apiKey = process.env.TEXT_TO_SPEECH_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error(
      "[tts-streaming-latency-harness] TEXT_TO_SPEECH_API_KEY is not set. This script requires a REAL Gemini TTS API key in the " +
        "environment to make real, billed API calls -- it never invents, hardcodes, or falls back to one.\n" +
        "Run it like: TEXT_TO_SPEECH_API_KEY=your-real-key npx tsx scripts/tts-streaming-latency-harness.ts --repeats 3",
    );
    process.exit(1);
  }
  return apiKey;
}

async function main(): Promise<void> {
  const apiKey = getApiKeyOrExit();

  const options = parseCliArgs(process.argv.slice(2));
  const resolvedOutDir = resolve(process.cwd(), options.outDir);
  await mkdir(resolvedOutDir, { recursive: true });

  console.log("[tts-streaming-latency-harness] Starting TRUE-STREAMING-vs-buffer-then-play latency measurement run.");
  console.log(
    `[tts-streaming-latency-harness] control-model=${options.controlModel} streaming-model=${options.streamingModel} repeats=${options.repeats} out=${resolvedOutDir}`,
  );
  console.log("[tts-streaming-latency-harness] This makes REAL, BILLED Gemini TTS API calls. Proceeding.");

  const runStartedAt = Date.now();
  const allAttempts: AttemptRecord[] = [];
  const allSummaries: GroupSummary[] = [];
  const comparisons: { sampleLabel: string; language: SampleLanguage; timeToFirstAudioDeltaPct: number | null }[] = [];

  for (const sample of SAMPLE_TEXTS) {
    const { attempts, controlSummary, candidateSummary } = await runSampleGroup(apiKey, sample, options, resolvedOutDir);
    allAttempts.push(...attempts);
    allSummaries.push(controlSummary, candidateSummary);

    const comparisonPct =
      controlSummary.timeToFirstAudioMedianMs !== null &&
      controlSummary.timeToFirstAudioMedianMs > 0 &&
      candidateSummary.timeToFirstAudioMedianMs !== null
        ? ((candidateSummary.timeToFirstAudioMedianMs - controlSummary.timeToFirstAudioMedianMs) / controlSummary.timeToFirstAudioMedianMs) * 100
        : null;
    comparisons.push({ sampleLabel: sample.label, language: sample.language, timeToFirstAudioDeltaPct: comparisonPct });

    printGroupReport(controlSummary, null);
    printGroupReport(candidateSummary, comparisonPct);
  }
  const runTotalMs = Date.now() - runStartedAt;

  console.log("");
  console.log(`[tts-streaming-latency-harness] Total run wall-clock time: ${runTotalMs}ms`);

  const resultsPath = join(resolvedOutDir, "results.json");
  const results = {
    generatedAt: new Date().toISOString(),
    controlModel: options.controlModel,
    streamingModel: options.streamingModel,
    repeats: options.repeats,
    outDir: resolvedOutDir,
    runTotalMs,
    summaries: allSummaries,
    comparisons,
    attempts: allAttempts,
  };
  await writeFile(resultsPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`[tts-streaming-latency-harness] Raw per-attempt results written to: ${resultsPath}`);
}

main().catch((error) => {
  console.error("[tts-streaming-latency-harness] Unexpected fatal error:", error);
  process.exit(1);
});
