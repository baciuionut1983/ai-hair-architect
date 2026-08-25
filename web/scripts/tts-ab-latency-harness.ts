// TTS A/B latency measurement harness (DEV-ONLY, standalone).
//
// WHAT THIS IS: a manually-run measurement script that calls the real
// Gemini TTS API directly, through the same GeminiTtsProvider class
// voice-reply/route.ts uses in production (src/lib/tts-provider-gemini.ts),
// and the same WAV-wrapping helpers it uses (src/lib/tts-audio-format.ts).
// It runs a fixed pair of sample texts (one Romanian, one English) against
// two model ids -- a "control" and a "candidate" -- several times each,
// records real wall-clock timings for every call, and writes both a
// human-readable console report and a raw results.json plus one playable
// .wav file per successful call, so a human can listen to control vs.
// candidate side by side and decide whether the candidate model is
// actually faster (and still sounds right) before anyone considers
// changing TEXT_TO_SPEECH_MODEL's default.
//
// WHY IT EXISTS: voice-reply/route.ts and voice-latency-logic.ts already
// measure production latency in detail, but only for whatever model is
// already configured live. There was no repeatable, isolated way to
// compare a candidate TTS model against the current one on identical
// input without touching production traffic, config, or code. This script
// is that comparison tool -- nothing more.
//
// COST WARNING: every synthesize() call this script makes is a REAL,
// BILLED Gemini TTS API call -- there is no mock/dry-run mode. Each full
// run performs (1 warm-up + `repeats` timed calls) x 2 models x 2 sample
// texts. Do not run this carelessly or repeatedly; a large --repeats
// value multiplies real cost accordingly.
//
// HOW TO RUN (from inside the web/ directory, with a real API key -- this
// script never invents, hardcodes, or falls back to one):
//
//   TEXT_TO_SPEECH_API_KEY=your-real-key npx tsx scripts/tts-ab-latency-harness.ts --repeats 5
//
// (On Windows PowerShell, set the env var first instead of inlining it:
//   $env:TEXT_TO_SPEECH_API_KEY = "your-real-key"
//   npx tsx scripts/tts-ab-latency-harness.ts --repeats 5
// )
//
// Optional flags (all have defaults -- see DEFAULT_* below):
//   --control <model>    control-arm model id
//   --candidate <model>  candidate-arm model id
//   --repeats <n>        timed calls per (model, language) group
//   --out <dir>          output directory for .wav files + results.json
//
// SCOPE / SAFETY: this file makes NO change whatsoever to any production
// code path, default model, or live user traffic. It is not imported by,
// and does not import from, anything under src/app or src/components. It
// only ever READS process.env.TEXT_TO_SPEECH_API_KEY and calls the real
// Gemini API with models chosen by its own CLI flags -- it never reads or
// writes TEXT_TO_SPEECH_MODEL or any other app config, and this file is
// excluded from the app's own typecheck gate (see web/tsconfig.json's
// `exclude`). It is a pure, isolated, offline measurement tool, run by
// hand, on demand, by a human who explicitly wants to spend real money to
// compare two TTS models.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseSampleRateFromMimeType, wrapPcmAsWav } from "../src/lib/tts-audio-format";
import { GeminiTtsProvider, type TtsProviderError } from "../src/lib/tts-provider-gemini";
import { computeLatencyStats, computeSuccessRate, type LatencyOutcome } from "../src/lib/tts-latency-stats";

const DEFAULT_CONTROL_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_CANDIDATE_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_REPEATS = 5;
const DEFAULT_OUT_DIR = "./tts-ab-results";

// Fixed, deliberately NOT configurable sample texts -- consistency across
// arms is the entire point of an A/B comparison. Copied verbatim; never
// paraphrased or regenerated per run.
const ROMANIAN_SAMPLE =
  "Bună! Pentru părul tău ondulat și des, recomand un tuns în straturi care să reducă volumul și să pună în evidență buclele naturale. Îți sugerez să folosești un balsam fără sulfați și să eviți periajul pe păr uscat, pentru a preveni frizul.";
const ENGLISH_SAMPLE =
  "Hi! Based on your hair texture and the photo you shared, I would recommend a layered cut to reduce bulk while keeping length. A leave-in conditioner with light hold would help control frizz without weighing your curls down.";

type SampleLanguage = "ro" | "en";

interface SampleText {
  language: SampleLanguage;
  languageCode: string;
  text: string;
}

const SAMPLE_TEXTS: SampleText[] = [
  { language: "ro", languageCode: "ro", text: ROMANIAN_SAMPLE },
  { language: "en", languageCode: "en", text: ENGLISH_SAMPLE },
];

interface CliOptions {
  controlModel: string;
  candidateModel: string;
  repeats: number;
  outDir: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    controlModel: DEFAULT_CONTROL_MODEL,
    candidateModel: DEFAULT_CANDIDATE_MODEL,
    repeats: DEFAULT_REPEATS,
    outDir: DEFAULT_OUT_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === "--control" && typeof value === "string") {
      options.controlModel = value;
      i += 1;
    } else if (flag === "--candidate" && typeof value === "string") {
      options.candidateModel = value;
      i += 1;
    } else if (flag === "--repeats" && typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.repeats = parsed;
      } else {
        console.error(`[tts-ab-latency-harness] Ignoring invalid --repeats value "${value}" (must be a positive integer); using ${options.repeats}.`);
      }
      i += 1;
    } else if (flag === "--out" && typeof value === "string") {
      options.outDir = value;
      i += 1;
    }
  }

  return options;
}

// One timed synthesize() call's complete, raw measurement -- every field
// here is either a real measured value or a real error detail, never a
// placeholder. audioProcessingMs/outputFile are null exactly when the
// call failed (the WAV-wrapping step never ran), and errorCode/errorMessage
// are null exactly when it succeeded -- never both populated, never both
// null.
interface AttemptRecord {
  model: string;
  language: SampleLanguage;
  attemptNumber: number;
  outcome: LatencyOutcome;
  providerLatencyMs: number;
  audioProcessingMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  outputFile: string | null;
}

interface GroupSummary {
  model: string;
  language: SampleLanguage;
  sampleCount: number;
  successRate: number;
  providerLatencyMedianMs: number;
  providerLatencyP95Ms: number | null;
  providerLatencyMinMs: number;
  providerLatencyMaxMs: number;
  audioProcessingMedianMs: number | null;
  groupWallClockMs: number;
}

function isTtsProviderError(error: unknown): error is TtsProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

// Runs the untimed warm-up call for one (model, language) group. Its
// outcome is logged to the console only -- deliberately excluded from
// every stats computation, since a cold-start call is not representative
// of steady-state latency.
async function runWarmup(provider: GeminiTtsProvider, sample: SampleText, model: string): Promise<void> {
  console.log(`[tts-ab-latency-harness] Warm-up: model=${model} language=${sample.language} ...`);
  try {
    await provider.synthesize(sample.text, sample.languageCode);
    console.log(`[tts-ab-latency-harness] Warm-up succeeded: model=${model} language=${sample.language}`);
  } catch (error) {
    if (isTtsProviderError(error)) {
      console.log(`[tts-ab-latency-harness] Warm-up failed (excluded from stats): model=${model} language=${sample.language} code=${error.code} message=${error.message}`);
    } else {
      console.log(`[tts-ab-latency-harness] Warm-up failed (excluded from stats, non-provider error): model=${model} language=${sample.language} error=${String(error)}`);
    }
  }
}

// Runs exactly one TIMED, INDEPENDENT synthesize() call, records the
// provider-latency wall-clock time around it, and -- only on success --
// wraps the resulting PCM as a WAV, records the wall-clock time around
// THAT step separately, and writes the file to disk. Never called
// concurrently with another attempt (the caller awaits this once per
// attempt, strictly in sequence) -- parallel calls would contend for the
// same rate limit and corrupt the latency numbers.
async function runTimedAttempt(
  provider: GeminiTtsProvider,
  sample: SampleText,
  model: string,
  attemptNumber: number,
  outDir: string,
): Promise<AttemptRecord> {
  const providerCallStartedAt = Date.now();
  let audioBase64: string | undefined;
  let mimeType: string | undefined;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let outcome: LatencyOutcome = "success";

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
  const providerLatencyMs = Date.now() - providerCallStartedAt;

  let audioProcessingMs: number | null = null;
  let outputFile: string | null = null;

  if (outcome === "success" && typeof audioBase64 === "string") {
    const audioProcessingStartedAt = Date.now();
    // Reusing the exact same helpers the real production route uses --
    // parseSampleRateFromMimeType + wrapPcmAsWav -- so these files are
    // real, valid, playable WAV files, not a reimplementation that could
    // silently diverge from what production actually ships.
    const sampleRateHz = parseSampleRateFromMimeType(mimeType);
    const pcm = Buffer.from(audioBase64, "base64");
    const wav = wrapPcmAsWav(pcm, sampleRateHz);
    audioProcessingMs = Date.now() - audioProcessingStartedAt;

    const fileName = `${model}__${sample.language}__attempt${attemptNumber}.wav`;
    await writeFile(join(outDir, fileName), wav);
    outputFile = fileName;
  }

  console.log(
    `[tts-ab-latency-harness] Attempt ${attemptNumber}/${model}/${sample.language}: outcome=${outcome} providerLatencyMs=${providerLatencyMs}` +
      (audioProcessingMs !== null ? ` audioProcessingMs=${audioProcessingMs}` : "") +
      (errorCode !== null ? ` errorCode=${errorCode} errorMessage=${errorMessage}` : ""),
  );

  return {
    model,
    language: sample.language,
    attemptNumber,
    outcome,
    providerLatencyMs,
    audioProcessingMs,
    errorCode,
    errorMessage,
    outputFile,
  };
}

function summarizeGroup(model: string, sample: SampleText, attempts: AttemptRecord[], groupWallClockMs: number): GroupSummary {
  const providerLatencyStats = computeLatencyStats(attempts.map((attempt) => attempt.providerLatencyMs));
  const successfulAudioProcessingMs = attempts
    .map((attempt) => attempt.audioProcessingMs)
    .filter((value): value is number => value !== null);
  // audio-processing stats only exist when at least one attempt actually
  // succeeded and reached the WAV-wrapping step -- never fabricated when
  // every attempt in the group failed.
  const audioProcessingMedianMs = successfulAudioProcessingMs.length > 0 ? computeLatencyStats(successfulAudioProcessingMs).median : null;

  return {
    model,
    language: sample.language,
    sampleCount: attempts.length,
    successRate: computeSuccessRate(attempts.map((attempt) => attempt.outcome)),
    providerLatencyMedianMs: providerLatencyStats.median,
    providerLatencyP95Ms: providerLatencyStats.p95,
    providerLatencyMinMs: providerLatencyStats.min,
    providerLatencyMaxMs: providerLatencyStats.max,
    audioProcessingMedianMs,
    groupWallClockMs,
  };
}

function formatMs(value: number | null): string {
  return value === null ? "n/a" : `${value}ms`;
}

function printGroupReport(summary: GroupSummary): void {
  console.log("");
  console.log(`=== ${summary.model} / ${summary.language} ===`);
  console.log(`  samples:                 ${summary.sampleCount}`);
  console.log(`  success rate:            ${(summary.successRate * 100).toFixed(1)}%`);
  console.log(`  provider latency median: ${formatMs(summary.providerLatencyMedianMs)}`);
  console.log(`  provider latency p95:    ${formatMs(summary.providerLatencyP95Ms)}`);
  console.log(`  provider latency min:    ${formatMs(summary.providerLatencyMinMs)}`);
  console.log(`  provider latency max:    ${formatMs(summary.providerLatencyMaxMs)}`);
  console.log(`  audio processing median: ${formatMs(summary.audioProcessingMedianMs)}`);
  console.log(`  group wall-clock time:   ${formatMs(summary.groupWallClockMs)}`);
}

async function runGroup(
  apiKey: string,
  model: string,
  sample: SampleText,
  repeats: number,
  outDir: string,
): Promise<{ attempts: AttemptRecord[]; summary: GroupSummary }> {
  const provider = new GeminiTtsProvider({ apiKey, model });

  const groupStartedAt = Date.now();
  await runWarmup(provider, sample, model);

  const attempts: AttemptRecord[] = [];
  // Strictly sequential, one at a time, never Promise.all -- concurrent
  // calls would contend for the same rate limit and corrupt the latency
  // numbers this whole script exists to measure accurately.
  for (let attemptNumber = 1; attemptNumber <= repeats; attemptNumber += 1) {
    const attempt = await runTimedAttempt(provider, sample, model, attemptNumber, outDir);
    attempts.push(attempt);
  }
  const groupWallClockMs = Date.now() - groupStartedAt;

  return { attempts, summary: summarizeGroup(model, sample, attempts, groupWallClockMs) };
}

// Validates TEXT_TO_SPEECH_API_KEY once, up front -- never invented,
// hardcoded, or defaulted, matching how seriously voice-reply/route.ts
// itself treats this exact same env var. exits(1) with a clear message
// rather than proceeding with no key, or an empty one.
function getApiKeyOrExit(): string {
  const apiKey = process.env.TEXT_TO_SPEECH_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error(
      "[tts-ab-latency-harness] TEXT_TO_SPEECH_API_KEY is not set. This script requires a REAL Gemini TTS API key in the " +
        "environment to make real, billed API calls -- it never invents, hardcodes, or falls back to one.\n" +
        "Run it like: TEXT_TO_SPEECH_API_KEY=your-real-key npx tsx scripts/tts-ab-latency-harness.ts --repeats 5",
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

  console.log("[tts-ab-latency-harness] Starting TTS A/B latency measurement run.");
  console.log(`[tts-ab-latency-harness] control=${options.controlModel} candidate=${options.candidateModel} repeats=${options.repeats} out=${resolvedOutDir}`);
  console.log("[tts-ab-latency-harness] This makes REAL, BILLED Gemini TTS API calls. Proceeding.");

  const runStartedAt = Date.now();
  const allAttempts: AttemptRecord[] = [];
  const allSummaries: GroupSummary[] = [];

  // Groups also run strictly sequentially (never Promise.all), for the
  // same rate-limit reason as the attempts within each group above.
  for (const model of [options.controlModel, options.candidateModel]) {
    for (const sample of SAMPLE_TEXTS) {
      const { attempts, summary } = await runGroup(apiKey, model, sample, options.repeats, resolvedOutDir);
      allAttempts.push(...attempts);
      allSummaries.push(summary);
    }
  }
  const runTotalMs = Date.now() - runStartedAt;

  console.log("");
  console.log("[tts-ab-latency-harness] All groups complete. Report:");
  for (const summary of allSummaries) {
    printGroupReport(summary);
  }
  console.log("");
  console.log(`[tts-ab-latency-harness] Total run wall-clock time: ${runTotalMs}ms`);

  const resultsPath = join(resolvedOutDir, "results.json");
  const results = {
    generatedAt: new Date().toISOString(),
    controlModel: options.controlModel,
    candidateModel: options.candidateModel,
    repeats: options.repeats,
    outDir: resolvedOutDir,
    runTotalMs,
    groups: allSummaries,
    attempts: allAttempts,
  };
  await writeFile(resultsPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`[tts-ab-latency-harness] Raw per-attempt results written to: ${resultsPath}`);
}

main().catch((error) => {
  console.error("[tts-ab-latency-harness] Unexpected fatal error:", error);
  process.exit(1);
});
