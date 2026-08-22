// Pure, browser-free decision logic for the chat composer mic's
// auto-stop-on-silence behaviour ("apas microfonul -> vorbesc -> dupa ~2
// secunde de liniste -> recording-ul se opreste automat"). Deliberately
// NOT a fixed "setTimeout 2 seconds after start" -- that would cut the
// stylist off mid-sentence on any pause. Instead, every sample loud enough
// to count as speech pushes the silence window forward, so only silence
// that comes AFTER speech was actually heard, and lasts long enough on its
// own, triggers a stop.
//
// End-of-speech hardening (2026-08-20): a real production report proved
// this file's ORIGINAL classifier -- "loud enough" (a bare RMS-amplitude
// threshold) counts as speech -- has no way to distinguish a stylist's
// voice from sustained ambient background music. In that report, the
// music stayed above the amplitude threshold continuously, so lastSpeechAt
// was pushed forward every single sample and stop_silence could never
// fire -- "Ascult..." stayed on screen indefinitely, exactly as reported.
// This was demonstrated by reading the code, not assumed: the OLD
// evaluateVadSample took a single scalar `level` and compared it only to
// `speechLevelThreshold` -- amplitude alone, nothing else.
//
// The fix adds two more signals no single loudness threshold can provide,
// using only what the existing AnalyserNode (already in use, see
// use-voice-recording.ts) can compute -- no new dependency:
//
// 1. Speech-band spectral ratio: real voiced speech concentrates the large
//    majority of its energy in roughly 300-3400 Hz (the standard telephony
//    band covering fundamental + the first few formants for most voices).
//    Sustained ambient sources this product's own salon environment
//    actually contains -- music (bass/treble-heavy), a hair dryer
//    (broadband/high-frequency noise), general room hum -- typically do
//    NOT concentrate energy there the way a voice does. A sample must
//    clear BOTH an amplitude gate AND a speech-band-ratio gate to count as
//    a speech candidate.
// 2. Adaptive noise floor: rather than one fixed absolute amplitude
//    threshold (which a sufficiently loud room permanently sits above),
//    the amplitude gate is `max(minAbsoluteLevel, noiseFloorEstimate *
//    noiseFloorMargin)` -- an exponential moving average of the recently
//    observed AMBIENT (non-speech-candidate) level, updated only from
//    samples that fail the speech-candidate test, so the stylist's own
//    voice can never drag the floor upward mid-sentence.
//
// Also added: a minimum sustained-speech duration (minSpeechDurationMs)
// before a speech candidate is actually confirmed as "the stylist has
// started speaking" -- filters a single loud transient (a knock, a music
// swell) from falsely opening the speech window -- and an unconditional
// maxRecordingDurationMs safety cap, since a repo-wide audit found NO
// existing upper bound on recording duration at all: if the classifier is
// ever fooled indefinitely, nothing before this stopped the mic short of
// a manual Stop click.
//
// Known, honest limitation (not solved by this heuristic, or by any
// single-microphone amplitude/spectral heuristic): a NEARBY PERSON TALKING
// has the same spectral signature as the stylist's own voice -- there is
// no way for this classifier to tell the two apart. This round targets
// non-speech ambient noise (music, hair dryers, machine hum), the
// specific, demonstrated production failure -- not background
// conversations. See this round's report for why a dedicated speaker
// separation/diarization solution is out of scope here.
//
// VAD false-negative hardening (2026-08-21): real production evidence
// showed genuinely intelligible speech (Gemini STT transcribed it
// successfully) repeatedly ending in stop_no_speech_timeout with
// speechDetectedAtMs: null -- i.e. hasDetectedSpeech NEVER flipped true,
// even though real speech was spoken. Root cause, demonstrated by reading
// the ORIGINAL isSpeechCandidate/streak logic below (before this round's
// fix): a speech candidate had to sustain for minSpeechDurationMs via an
// UNBROKEN run of samples that ALL individually cleared BOTH the
// amplitude gate AND the spectral-ratio gate -- a single sample among
// that run (an unvoiced consonant, a breath, a momentary dip below either
// gate) reset speechStreakStartedAt to null unconditionally, discarding
// ALL accumulated progress. Real speech is not acoustically uniform at
// 100ms granularity; requiring a perfectly unbroken run is a far stricter
// bar than "is this audio intelligible as speech" -- which is exactly why
// STT (which reasons over the whole utterance holistically, not
// frame-by-frame) could succeed on audio this classifier rejected outright.
//
// This ALSO explains the companion telemetry finding (speechDetectedAtMs:
// null while speechEndedAtMs has a real value): lastSpeechAt already
// updated on ANY speech-candidate sample, confirmed or not (see
// isSpeechCandidate's own call site below) -- so a streak that produced
// real candidate samples but never sustained long enough to confirm still
// left a real "last candidate" timestamp behind. This is legitimate,
// truthful telemetry (real candidate-like audio existed, it just never
// accumulated enough evidence to confirm), not a bug to paper over --
// see this round's own report for why speechDetectedAtMs/speechEndedAtMs
// keep their existing meaning unchanged, and why vadMaxCandidateSpeechMs
// (below) is the new field that makes this distinction directly visible
// instead of ambiguous.
//
// The fix: tolerate a SHORT gap (maxCandidateGapMs) since the last
// candidate-like sample before discarding an in-progress streak, instead
// of resetting on the very first failing sample. This is a change to the
// STATE/CLASSIFICATION LOGIC, not to either threshold (minAbsoluteLevel,
// minSpeechBandRatio, noiseFloorMargin are all unchanged) -- a single
// missed sample within an otherwise-forming speech streak no longer wipes
// out all prior progress, while a genuinely longer gap (no candidate-like
// evidence at all for maxCandidateGapMs) still resets it, exactly as
// before. Background-music protection is untouched: music must still
// clear the SAME per-sample amplitude+spectral gate to ever become a
// candidate at all; this only changes how tolerantly an already-forming
// candidate streak survives a brief interruption, which sustained,
// spectrally-flat music essentially never produces (see this round's own
// regression test "real speech over moderate background music/noise" and
// "background music alone must not recreate the infinite-listening bug").
//
// VAD false-negative hardening, ROUND 2 (2026-08-22): the round-1 gap-
// tolerance fix was NOT sufficient -- a real production retest on this
// build still ended stop_no_speech_timeout on genuinely intelligible
// speech. That test's own new telemetry is the key evidence: peakRms
// ~0.160 (a healthy 8x above the ~0.0068 final noise floor -- amplitude
// was almost certainly never the bottleneck for most of the utterance)
// and peakSpeechBandRatio ~0.799 (real, strongly speech-shaped evidence
// DID occur), yet fullyQualifiedSampleCount was only 2 for the entire
// 10-second recording, and maxCandidateSpeechMs only 104ms -- meaning the
// two samples that passed BOTH gates simultaneously were themselves
// essentially back-to-back (one round-1 gap-tolerance window's worth),
// with no other qualifying sample anywhere else in the recording.
//
// This rules out round 1's own diagnosis (an otherwise-CONSISTENTLY-
// qualifying stream interrupted by occasional single-sample dips) as the
// dominant failure mode here: with only 2 total qualifying samples across
// what a 30-character message likely took 1.5-2.5s to speak, the problem
// is that FEW samples ever cleared both gates AT THE SAME TIME, not that
// a mostly-qualifying stream had brief interruptions. No amount of
// temporal gap-tolerance can manufacture qualifying evidence that never
// existed; only widening the tolerance far enough to accept 1-in-10 (or
// sparser) qualifying rates would fix this specific case, and doing that
// blindly is exactly the "increase maxCandidateGapMs speculatively" or
// "lower minSpeechBandRatio" move this round was told not to make -- it
// would also measurably weaken the background-music rejection this same
// module exists to protect, since occasional spectral flukes in sustained
// music become far more likely to accumulate as `maxCandidateGapMs` or an
// evidence-window's tolerance grows.
//
// Two real, unresolved candidate explanations remain, and this round's
// own new telemetry (vadAmplitudeQualifiedSampleCount/
// vadSpectralQualifiedSampleCount/vadTotalSampleCount/
// vadLongestCandidateGapMs/vadPeakNoiseFloor, see VoiceActivityDiagnostics
// below) is designed to distinguish them on the NEXT real production
// test, not guessed at here:
//   (a) the spectral-ratio gate itself may be volatile frame-to-frame for
//       genuine continuous speech (sibilants/plosives/formant transitions
//       naturally shift energy outside the 300-3400Hz band moment to
//       moment, even mid-utterance) -- vadSpectralQualifiedSampleCount
//       will be low relative to vadTotalSampleCount even while
//       vadAmplitudeQualifiedSampleCount stays high, if so;
//   (b) the two gates may rarely align in the SAME 100ms frame even when
//       each individually looks fine across the recording --
//       vadAmplitudeQualifiedSampleCount and vadSpectralQualifiedSampleCount
//       would BOTH be reasonably high while vadFullyQualifiedSampleCount
//       stays low, pointing at a measurement-alignment/smoothing problem
//       rather than either threshold.
// This round deliberately ships DIAGNOSTIC TELEMETRY ONLY, not a new
// confirmation algorithm -- see this round's own report for why choosing
// between a spectral-ratio smoothing fix, a genuine rolling-evidence-
// window redesign, or something else without this data would be exactly
// the speculative tuning this task was told not to do.
//
// VAD false-negative hardening, ROUND 3 (2026-08-22): the round-2
// telemetry (real production retest, this build) answered its own
// question -- explanation (b), gate-misalignment, is what happened, and
// it has an identified, mechanical cause. amplitudeQualifiedSampleCount
// was 19/100 despite a healthy peakRms (0.359); spectralQualifiedSampleCount
// was 69/100; fullyQualifiedSampleCount (both, same sample) only 5/100.
// peakNoiseFloor reached 0.0565 -- ~8x the ~0.0068 TRUE ambient floor a
// prior quiet-room test actually measured -- meaning the floor learned
// from the stylist's OWN voice, not the room.
//
// Root cause, found by reading the noise-floor update condition (below):
// it excluded a sample from the ambient EMA only when the sample passed
// BOTH gates (`candidate`). A sample that is genuinely speech (clears the
// spectral gate -- this module's own most voice-specific signal) but
// happens to be a little quiet or mid-transition (fails the adaptive
// amplitude gate) was still folded into the floor as if it were ambient
// noise. Since the amplitude gate is ITSELF derived from this floor
// (amplitudeFloor = floor * noiseFloorMargin), this is a feedback loop:
// real-but-quiet speech raises the floor, which raises the amplitude bar,
// which makes MORE real speech fail amplitude and get folded in too --
// the floor chases the speaker's own voice upward over one recording.
//
// The fix: exclude a sample from floor adaptation whenever it clears the
// SPECTRAL gate alone, not the full `candidate`. Spectral concentration
// is independent of the adaptive floor (unlike amplitude, it cannot be
// circularly self-reinforcing), so it is the correct signal for "is this
// credible speech evidence, regardless of loudness". The candidate/streak/
// decision logic that determines hasDetectedSpeech is completely
// unchanged -- still requires BOTH gates on the same sample -- so this is
// a change to the floor's own inputs only, not to what counts as
// confirmed speech. Music/dryer-noise rejection is untouched: those
// signals are specifically the ones that FAIL the spectral gate (see this
// module's own background-music regression tests), so they still update
// the floor exactly as before.
//
// VAD false-negative hardening, ROUND 4 (2026-08-22): a real production
// retest on 803c538, with the speaker deliberately talking naturally for
// 5-7 seconds, gave the most decisive evidence yet:
//   amplitudeQualifiedSampleCount: 26/100
//   spectralQualifiedSampleCount:  20/100
//   fullyQualifiedSampleCount (BOTH, same 100ms sample): 1/100
// Both individual gates found substantial evidence; the SAME-FRAME
// overlap was almost nonexistent (1, vs. ~5 expected if the two gates
// were statistically independent -- the true overlap is even lower than
// chance would predict). Three separate real recordings now (round 2: 2%
// overlap, round 3: 5%, round 4: 1%) all show this same shape: healthy
// individual-gate rates, near-zero same-sample coincidence. This is no
// longer a one-off fluke to explain away -- it is the dominant, repeated
// failure mode.
//
// PHASE A ROOT CAUSE (DSP + acoustic-phonetics, not a threshold problem):
// rmsLevel and speechBandRatio are read from the SAME AnalyserNode,
// milliseconds apart in the same JS tick (see use-voice-recording.ts's
// computeRmsLevel/computeSpeechBandRatio) -- they are not looking at
// meaningfully different points in time due to any bug in this file. Two
// real factors explain the misalignment instead:
//   1. getByteTimeDomainData (RMS) is a raw, instantaneous read of the
//      last ~21ms (fftSize=1024 samples) of waveform. getByteFrequencyData
//      (speechBandRatio) is NOT instantaneous by default: the Web Audio
//      API applies time-smoothing via AnalyserNode.smoothingTimeConstant,
//      which this codebase never explicitly sets, so it silently inherits
//      the spec's default of 0.8 -- a real, previously-undocumented fact
//      found by this audit. This blends each read with recent history,
//      an asymmetry the RMS side does not have.
//   2. More fundamentally, loudness and speech-band spectral concentration
//      are genuinely, moment-to-moment DIFFERENT properties of continuous
//      speech, not two views of the same thing: plosive bursts and
//      sibilants ("s", "sh", "t", "k") are often LOUD but spread energy
//      well above 3400Hz (poor speech-band concentration), while quieter
//      vowel/nasal steady-states concentrate energy tightly in-band at
//      lower amplitude. A single phoneme rarely maximizes both at once,
//      and at ~10 polls/second (AUDIO_LEVEL_SAMPLE_INTERVAL_MS=100) against
//      phonemes that change every 50-200ms, each poll essentially samples
//      a random phase of this alternation. Requiring the SAME 100ms poll
//      to catch both a loud instant AND a narrow-band instant is asking
//      for a coincidence real running speech does not reliably produce --
//      this is why a genuinely intelligible, STT-transcribed utterance can
//      score 26% and 20% individually yet overlap only 1% of the time.
//
// Both explanations point the same direction: the SAME-FRAME AND
// (`candidate = amplitudeQualified && spectralQualified`, used for the
// hasDetectedSpeech/streak decision) is confirmed as a structural problem
// for continuous natural speech, not merely a badly-tuned threshold --
// exactly what this round's audit was asked to determine before touching
// any code.
//
// THE FIX (Phase C/D): a bounded temporal evidence-fusion model,
// `windowedCandidate`, computed in evaluateVadSample below. A sample
// counts as a windowed candidate if it clears ONE gate itself and the
// OTHER gate was cleared by some recent sample, within
// speechEvidenceWindowMs -- not necessarily the identical sample. This
// generalizes (and, at speechEvidenceWindowMs=0, is identical to) the old
// same-frame `candidate`, so it is a strict widening, not a replacement
// mechanism. It reuses 100% of the EXISTING streak/gap-tolerance/
// minSpeechDurationMs/silenceDurationMs machinery unchanged -- only the
// definition of "does this instant count as qualifying evidence" changes,
// which automatically applies to both speech START (streak accumulation,
// still gated by the unchanged minSpeechDurationMs -- conservative, per
// Phase D) and CONTINUATION (lastSpeechAt refresh, already structurally
// more lenient than START since it only needs one qualifying instant per
// silenceDurationMs, not a sustained streak -- Phase D's asymmetry falls
// out of the existing two-tier design, not a new parallel mechanism).
//
// Why this cannot reintroduce the original "music never stops listening"
// bug: music (and broadband/dryer noise) structurally, continuously fails
// the SPECTRAL gate (see this module's own background-music regression
// tests) -- not merely rarely, but essentially never. Since every branch
// of windowedCandidate requires spectralQualified to be true EITHER on
// this sample OR within the recent window, and music never makes
// spectralQualified true at all, `spectralRecentlyQualified` never
// becomes true for sustained music either -- windowedCandidate stays
// false for music regardless of window size, exactly as strict AND did.
// The one bounded exception: if real speech ends and music continues
// immediately after, a residual "recently qualified" spectral timestamp
// from the tail of real speech can let up to ~speechEvidenceWindowMs of
// music-only audio still count as windowedCandidate (since spectral
// evidence is real, just aging out) -- this only delays stop_silence by
// at most that bound, never indefinitely (see this round's own regression
// test proving the bound).
//
// Phase B (re-examining 803c538): peakNoiseFloor reached 0.1025 this
// round (noiseFloorMargin 1.6 implies an effective peak amplitude
// threshold near 0.164). 803c538's exclusion (`spectralQualified` alone)
// is CONFIRMED CORRECT and is NOT reverted or broadened this round.
// amplitudeQualifiedSampleCount (26) minus fullyQualifiedSampleCount (1)
// leaves up to 25 samples that were LOUD but NOT spectrally qualified --
// exactly the class 803c538 does not protect, since by construction they
// look identical, on the only two signals this classifier has, to genuine
// loud ambient noise (sibilants/plosives/breath ARE loud and spectrally
// diffuse, same as a hair dryer). A broader exclusion
// (`amplitudeQualified || spectralQualified`) was seriously considered and
// REJECTED: amplitude alone does not discriminate voice from ambient
// noise at all (that is the entire reason the spectral gate exists), and
// broadening on it would freeze floor-adaptation for genuinely loud
// AMBIENT sources too -- verified against the existing "noise floor rises
// to track sustained ambient noise" test/mechanism, where AMBIENT_NOISE
// itself clears the (low, still-adapting) amplitude gate early on, so
// this broadening would have stopped the floor from ever learning
// genuine room noise. This residual gap is a structural limit of a
// 2-signal (RMS + spectral-ratio) classifier, not a bug with a safe,
// minimal fix -- left as an honest, documented limitation rather than
// patched speculatively.
//
// FFT smoothing (Phase A's `smoothingTimeConstant` finding) is
// deliberately NOT changed this round either: it is real (never set,
// defaults to 0.8) and a plausible secondary contributor, but (a) it is
// browser-only and cannot be unit-tested in this codebase the way the
// state-machine logic can, (b) the windowed-evidence model above already
// tolerates timing offsets up to speechEvidenceWindowMs regardless of
// WHY amplitude and spectral evidence are offset, making this fix
// non-load-bearing for the reported failure, and (c) changing an
// unverifiable timing parameter in the same round as a state-machine
// redesign would make a future test's result impossible to attribute to
// either change individually. Documented here for a future round if the
// windowed model alone proves insufficient.
//
// VAD false-negative hardening, ROUND 5 (2026-08-22): a fourth real
// production retest on b06d114 (windowed-evidence model active) STILL
// ended stop_no_speech_timeout, but the new telemetry shows real,
// measurable progress and pinpoints the next bottleneck precisely:
//   amplitudeQualifiedSampleCount: 11/100 (down from round 4's 26/100)
//   spectralQualifiedSampleCount:  47/100 (up from round 4's 20/100)
//   fullyQualifiedSampleCount (same-sample):    1/100
//   windowedCandidateSampleCount (ROUND 4 fix): 7/100 -- 7x fullyQualified,
//     proof the windowed model IS helping, just not yet enough
//   maxCandidateSpeechMs: 191ms -- within 59ms of minSpeechDurationMs
//     (250ms), the closest any recording has come to confirming
//   peakNoiseFloor: 0.0863 -- ~12.7x the ~0.0068 TRUE quiet-room baseline
//
// This is now the SAME underlying mechanism Phase B already diagnosed on
// 803c538, just still active: amplitude evidence is scarce (11/100)
// because the floor is still elevated, and 803c538's exclusion
// (`spectralQualified`, this exact sample only) does not protect a
// sample that is genuinely PART of an ongoing utterance -- a plosive
// burst or sibilant mid-word, loud but momentarily not speech-band-
// concentrated -- occurring a few samples away from a spectrally-
// qualified neighbor. Every such sample still gets folded into the
// ambient EMA, keeping the floor (and therefore the amplitude bar)
// elevated, which is exactly why amplitude evidence dropped even lower
// this round than in round 4's own test (11/100 vs 26/100) despite a
// HIGHER spectral rate (47/100 vs 20/100) -- more of the utterance was
// genuinely spectrally concentrated, but the floor had even less
// tolerance left for amplitude to also succeed.
//
// The fix reuses -- does not invent -- the exact same recency signal
// ROUND 4 already computes and validates: a sample is now ALSO excluded
// from floor adaptation when `spectralRecentlyQualified` (spectral
// evidence within speechEvidenceWindowMs of THIS sample), not only when
// it is spectrally qualified itself. This is the direct floor-side
// counterpart of ROUND 4's own confirmation-side insight -- evidence
// from one modality shortly before/after evidence from the other
// belongs to the same utterance -- applied consistently to the ONE
// place it wasn't yet applied. No new tunable parameter: it reuses
// speechEvidenceWindowMs and the already-computed
// lastSpectralQualifiedAt, not a new threshold invented for this round.
//
// Why this preserves music/dryer-noise rejection: `spectralRecentlyQualified`
// can only be true within speechEvidenceWindowMs (300ms) of a GENUINE
// prior spectral qualification -- sustained music/broadband noise never
// produces one at all (see this module's own background-music regression
// tests), so this exclusion never activates for them, exactly the same
// bounded-leakage guarantee already proven for windowedCandidate itself
// (see the "music immediately after real speech" regression test, which
// this round extends to also cover the floor).
//
// Why amplitude-based broadening remains rejected (Phase B, unchanged
// from 803c538's own reasoning): amplitude alone still cannot
// discriminate voice from genuine ambient noise, so it is still never
// used as a floor-exclusion signal on its own, this round or any other.
//
// Phase A (this round): the aggregate counters ALREADY present
// (candidateResetCount: 3, maxCandidateSpeechMs: 191ms,
// windowedCandidateSampleCount: 7) were sufficient, combined with reading
// the streak-survival code below, to prove a SECOND, independent root
// cause -- no new telemetry was needed to find or fix it (more granular
// per-gap-bucket/per-cause telemetry was considered per this round's own
// task and deliberately not added, since it would not have changed this
// round's diagnosis or fix; left for a future round if the fix below
// proves insufficient on its own).
//
// Phase D finding: two temporal tolerances were operating INCONSISTENTLY.
// windowedCandidate (ROUND 4) already treats cross-modal evidence as
// "fresh" for up to speechEvidenceWindowMs (300ms). But the STREAK-
// SURVIVAL check below -- whether an in-progress (not yet confirmed)
// streak discards its progress across a gap -- was still gated on the
// OLDER, tighter maxCandidateGapMs (150ms, calibrated in round 1 for the
// very different same-sample-AND world, where "a candidate sample" meant
// something much rarer). Two windowedCandidate=true samples 150-300ms
// apart -- BOTH individually still valid per windowedCandidate's own
// recency logic -- could still have the STREAK discarded between them by
// this stricter, inconsistent bound, exactly matching the observed
// symptom (candidateResetCount: 3, maxCandidateSpeechMs stalling at
// 191ms despite 7 real windowedCandidate hits across the recording).
//
// The fix: derive the streak-survival tolerance as
// Math.max(maxCandidateGapMs, speechEvidenceWindowMs) instead of
// maxCandidateGapMs alone. Neither named config value is deleted or
// blindly increased -- maxCandidateGapMs still means exactly what it did
// in round 1, and still governs streak survival on its own whenever it
// is the LARGER of the two (e.g. if a future round lowers
// speechEvidenceWindowMs below it). This only removes the accidental,
// undocumented inconsistency between two mechanisms introduced in
// different rounds, making the streak's own survival rule consistent
// with what windowedCandidate already promises elsewhere in the same
// function.
//
// Phase C (noise model): of the five alternative floor-adaptation designs
// this round's task asked to weigh, "freeze/strongly slow upward
// adaptation when credible cross-modal speech evidence exists" is the one
// implemented (see the noiseFloorEstimate change above) -- it is bounded
// (at most speechEvidenceWindowMs, never a permanent freeze, so genuine
// salon background changes are still learned normally once no recent
// speech evidence exists) and reuses an already-validated signal. The
// other four were considered and NOT chosen this round: a pre-speech-only
// calibration period has a chicken-and-egg problem (VAD cannot know
// speech hasn't started yet without deciding the very thing it's trying
// to protect); asymmetric (slow-up/fast-down) adaptation and a capped-
// upward-movement-relative-to-a-trusted-baseline both require inventing
// new, unvalidated rate/baseline constants with no production evidence to
// ground them; a fully separate ambient-baseline-vs-instantaneous-
// estimate model is a materially bigger architectural change than this
// round's evidence justifies on its own.

export interface VadConfig {
  // Absolute floor beneath which nothing ever counts as speech, regardless
  // of the adaptive noise floor -- prevents a near-silent room's own
  // adaptive floor from drifting toward zero and becoming hypersensitive
  // to any tiny sound. A rough, commonly-cited starting point for mic
  // input on a typical laptop/headset -- expect this to need live tuning,
  // so it's a named, overridable config value, never a magic number
  // inlined at the call site.
  minAbsoluteLevel: number;
  // A sample's RMS level must be at least this many times the current
  // adaptive noise floor estimate to be a speech candidate on the
  // amplitude axis. Needs live tuning against real salon recordings.
  noiseFloorMargin: number;
  // How much weight each new AMBIENT (non-speech-candidate) sample gets in
  // the exponential moving average that tracks the noise floor -- small,
  // so the floor tracks genuinely SUSTAINED ambient levels (music, a hair
  // dryer left running) rather than reacting to every brief fluctuation.
  noiseFloorAdaptRate: number;
  // Minimum fraction (0..1) of a sample's total spectral energy that must
  // fall within the speech band (see module comment: ~300-3400 Hz) for it
  // to count as a speech candidate. The second, independent gate --
  // amplitude alone is never sufficient.
  minSpeechBandRatio: number;
  // A speech candidate must sustain for at least this long, continuously,
  // before hasDetectedSpeech actually flips true -- filters a single loud
  // transient from opening the speech window.
  minSpeechDurationMs: number;
  // How long a silence must persist AFTER speech was confirmed before
  // auto-stopping -- "aproximativ 2 secunde de liniste dupa ce s-a detectat
  // vorbire", not from recording start.
  silenceDurationMs: number;
  // Safety net: if NO speech is ever confirmed at all (silence, or
  // non-speech ambient noise, the whole time -- dead mic, wrong input
  // device, stylist changed their mind), stop anyway after this long from
  // recording start.
  noSpeechTimeoutMs: number;
  // Unconditional safety cap, independent of speech state entirely: if
  // nothing else has stopped the recording by this point, stop anyway. The
  // last line of defense against a classifier that's somehow still fooled.
  maxRecordingDurationMs: number;
  // VAD false-negative hardening (2026-08-21): the longest gap, since the
  // last speech-candidate sample, an in-progress (not-yet-confirmed)
  // streak can survive before being discarded -- see this module's own
  // doc comment above for the real production false-negative this fixes.
  // A little more than one sampling interval (use-voice-recording.ts
  // samples at 100ms) so a single missed sample never wipes out real
  // progress, without being generous enough to stitch together genuinely
  // separate blips spaced further apart.
  //
  // VAD false-negative hardening, ROUND 5 (2026-08-22): the ACTUAL
  // streak-survival tolerance used by evaluateVadSample is
  // Math.max(maxCandidateGapMs, speechEvidenceWindowMs), not this value
  // alone -- see this module's own ROUND 5 doc comment for the real
  // production evidence that the two had drifted inconsistent (this
  // field calibrated in round 1, speechEvidenceWindowMs added in round 4)
  // and were discarding streak progress windowedCandidate's own recency
  // logic would still consider valid. This field's own value and meaning
  // are unchanged; it still governs survival directly whenever it is the
  // larger of the two.
  maxCandidateGapMs: number;
  // VAD false-negative hardening, ROUND 4 (2026-08-22): how far apart (in
  // either order) an amplitude-qualified sample and a spectral-qualified
  // sample can be and still count as ONE combined piece of speech evidence
  // (a "windowed candidate") -- see this module's own ROUND 4 doc comment
  // for the real production evidence (three separate recordings, each
  // with healthy individual-gate rates but near-zero SAME-SAMPLE overlap)
  // and the DSP/acoustic-phonetics reasoning for why requiring both gates
  // on the identical 100ms sample does not reliably work for continuous
  // natural speech. Roughly one syllable's duration and 3x the 100ms
  // sampling interval -- long enough to link one syllable's alternating
  // loud/narrow-band moments, short enough that it cannot bridge genuinely
  // unrelated, temporally-distant events. At 0, this collapses exactly to
  // the original same-sample AND.
  speechEvidenceWindowMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  minAbsoluteLevel: 0.02,
  noiseFloorMargin: 1.6,
  noiseFloorAdaptRate: 0.05,
  minSpeechBandRatio: 0.45,
  minSpeechDurationMs: 250,
  silenceDurationMs: 2000,
  noSpeechTimeoutMs: 10000,
  maxRecordingDurationMs: 60000,
  maxCandidateGapMs: 150,
  speechEvidenceWindowMs: 300,
};

// One fresh audio-level sample. Both fields are computed browser-side from
// the SAME AnalyserNode already in use (use-voice-recording.ts) -- rmsLevel
// from time-domain byte data (unchanged from before this round),
// speechBandRatio newly from frequency-domain byte data. Kept as two plain
// numbers (not raw Uint8Arrays) so this stays a pure, browser-free module.
export interface VadSample {
  rmsLevel: number;
  speechBandRatio: number;
}

export interface VadState {
  hasDetectedSpeech: boolean;
  // Timestamp (same clock as the `now` passed to evaluateVadSample -- e.g.
  // performance.now()) of the most recent sample that counted as a
  // (confirmed-or-candidate) speech sample.
  lastSpeechAt: number | null;
  recordingStartedAt: number;
  // Exponential moving average of the ambient (non-speech-candidate)
  // level -- see noiseFloorAdaptRate. Starts at 0; minAbsoluteLevel alone
  // protects the first samples before any real estimate has formed.
  noiseFloorEstimate: number;
  // When the CURRENT streak of speech-candidate samples began -- null only
  // once the gap since the last candidate sample has exceeded
  // maxCandidateGapMs (see that config field's own doc comment), not on
  // every single non-candidate sample. Used to measure minSpeechDurationMs.
  speechStreakStartedAt: number | null;
  // VAD false-negative hardening (2026-08-21) diagnostic accumulators --
  // never reset mid-recording, always reflect the whole recording so far.
  // See VoiceActivityDiagnostics's own doc comments for what each answers.
  peakRms: number;
  peakSpeechBandRatio: number;
  maxCandidateStreakMs: number;
  candidateResetCount: number;
  fullyQualifiedSampleCount: number;
  // VAD false-negative hardening, ROUND 2 (2026-08-22) diagnostic
  // accumulators -- see this module's own ROUND 2 doc comment for why
  // these exist, and VoiceActivityDiagnostics's own doc comments for what
  // each answers.
  amplitudeQualifiedSampleCount: number;
  spectralQualifiedSampleCount: number;
  totalSampleCount: number;
  longestCandidateGapMs: number;
  peakNoiseFloor: number;
  // VAD false-negative hardening, ROUND 4 (2026-08-22): the timestamp of
  // the most recent sample that individually cleared each gate --
  // independent of one another, and independent of whether the OTHER gate
  // was also cleared -- used to compute windowedCandidate (see
  // evaluateVadSample below and this module's own ROUND 4 doc comment).
  // Never reset except by a fresh recording (initVadState).
  lastAmplitudeQualifiedAt: number | null;
  lastSpectralQualifiedAt: number | null;
  // How many samples counted as a windowedCandidate (cross-modality,
  // within speechEvidenceWindowMs -- see VoiceActivityDiagnostics's own
  // doc comment) -- distinct from fullyQualifiedSampleCount, which keeps
  // its existing strict SAME-SAMPLE meaning so the raw same-frame overlap
  // rate stays independently observable in future telemetry.
  windowedCandidateSampleCount: number;
}

export function initVadState(recordingStartedAt: number): VadState {
  return {
    hasDetectedSpeech: false,
    lastSpeechAt: null,
    recordingStartedAt,
    noiseFloorEstimate: 0,
    speechStreakStartedAt: null,
    peakRms: 0,
    peakSpeechBandRatio: 0,
    maxCandidateStreakMs: 0,
    candidateResetCount: 0,
    fullyQualifiedSampleCount: 0,
    amplitudeQualifiedSampleCount: 0,
    spectralQualifiedSampleCount: 0,
    totalSampleCount: 0,
    longestCandidateGapMs: 0,
    peakNoiseFloor: 0,
    lastAmplitudeQualifiedAt: null,
    lastSpectralQualifiedAt: null,
    windowedCandidateSampleCount: 0,
  };
}

export type VadDecision = "continue" | "stop_silence" | "stop_no_speech_timeout" | "stop_max_duration";

export interface VadEvaluation {
  state: VadState;
  decision: VadDecision;
}

// VAD false-negative hardening, ROUND 2 (2026-08-22): split into its two
// independent gates (rather than returning one combined boolean) so
// evaluateVadSample can tell WHICH gate a given sample cleared -- the
// diagnostic data this round's real production evidence proved is needed
// to distinguish "amplitude is the bottleneck" from "spectral ratio is
// the bottleneck" from "both individually pass but rarely align", instead
// of inferring it indirectly from peak values alone.
function classifySpeechGates(
  sample: VadSample,
  noiseFloorEstimate: number,
  config: VadConfig,
): { amplitudeQualified: boolean; spectralQualified: boolean; candidate: boolean } {
  const amplitudeFloor = Math.max(config.minAbsoluteLevel, noiseFloorEstimate * config.noiseFloorMargin);
  const amplitudeQualified = sample.rmsLevel >= amplitudeFloor;
  const spectralQualified = sample.speechBandRatio >= config.minSpeechBandRatio;
  return { amplitudeQualified, spectralQualified, candidate: amplitudeQualified && spectralQualified };
}

// Feed one fresh audio-level sample in. Returns the updated state (thread
// this back in as `state` on the next call) and what the caller should do.
// A short pause between words never trips stop_silence: any speech-
// candidate sample immediately pushes lastSpeechAt forward, restarting the
// silenceDurationMs countdown from scratch.
export function evaluateVadSample(
  state: VadState,
  sample: VadSample,
  now: number,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): VadEvaluation {
  // Checked first, unconditionally -- independent of speech state, so
  // nothing that fools the classifier below can ever keep the mic open
  // past this.
  if (now - state.recordingStartedAt >= config.maxRecordingDurationMs) {
    return { state, decision: "stop_max_duration" };
  }

  const { amplitudeQualified, spectralQualified, candidate } = classifySpeechGates(sample, state.noiseFloorEstimate, config);

  // VAD false-negative hardening, ROUND 4 (2026-08-22): cross-modality
  // windowed evidence -- see this module's own ROUND 4 doc comment for the
  // full production evidence and DSP/acoustic reasoning. A sample counts
  // as a windowed candidate if it clears ONE gate itself and the OTHER
  // gate was cleared by some recent sample, within speechEvidenceWindowMs
  // -- not necessarily this identical sample. Reduces exactly to the old
  // same-sample `candidate` when speechEvidenceWindowMs is 0.
  const spectralRecentlyQualified =
    state.lastSpectralQualifiedAt !== null && now - state.lastSpectralQualifiedAt <= config.speechEvidenceWindowMs;
  const amplitudeRecentlyQualified =
    state.lastAmplitudeQualifiedAt !== null && now - state.lastAmplitudeQualifiedAt <= config.speechEvidenceWindowMs;
  const windowedCandidate =
    (amplitudeQualified && spectralQualified) ||
    (amplitudeQualified && spectralRecentlyQualified) ||
    (spectralQualified && amplitudeRecentlyQualified);
  const lastAmplitudeQualifiedAt = amplitudeQualified ? now : state.lastAmplitudeQualifiedAt;
  const lastSpectralQualifiedAt = spectralQualified ? now : state.lastSpectralQualifiedAt;

  // VAD false-negative hardening (2026-08-21 / ROUND 2 2026-08-22 / ROUND
  // 4 2026-08-22) diagnostic accumulators -- tracked unconditionally,
  // every sample, regardless of candidate status. See
  // VoiceActivityDiagnostics's own doc comments for what each answers.
  const peakRms = Math.max(state.peakRms, sample.rmsLevel);
  const peakSpeechBandRatio = Math.max(state.peakSpeechBandRatio, sample.speechBandRatio);
  const peakNoiseFloor = Math.max(state.peakNoiseFloor, state.noiseFloorEstimate);
  const totalSampleCount = state.totalSampleCount + 1;
  const amplitudeQualifiedSampleCount = amplitudeQualified ? state.amplitudeQualifiedSampleCount + 1 : state.amplitudeQualifiedSampleCount;
  const spectralQualifiedSampleCount = spectralQualified ? state.spectralQualifiedSampleCount + 1 : state.spectralQualifiedSampleCount;
  const windowedCandidateSampleCount = windowedCandidate
    ? state.windowedCandidateSampleCount + 1
    : state.windowedCandidateSampleCount;
  // The largest gap ever seen BETWEEN two consecutive windowed-candidate
  // samples -- distinct from candidateResetCount (which only counts how
  // many times a streak was discarded): this measures how far apart in
  // real time qualifying evidence actually was, regardless of whether a
  // streak was in progress. Only updated when THIS sample is itself a
  // windowed candidate and a prior one exists.
  const longestCandidateGapMs =
    windowedCandidate && state.lastSpeechAt !== null
      ? Math.max(state.longestCandidateGapMs, now - state.lastSpeechAt)
      : state.longestCandidateGapMs;
  const diagnosticAccumulators = {
    peakRms,
    peakSpeechBandRatio,
    peakNoiseFloor,
    totalSampleCount,
    amplitudeQualifiedSampleCount,
    spectralQualifiedSampleCount,
    windowedCandidateSampleCount,
    longestCandidateGapMs,
    lastAmplitudeQualifiedAt,
    lastSpectralQualifiedAt,
  };

  // The noise floor only ever learns from samples that show NO credible
  // speech evidence -- otherwise the stylist's own voice would drag the
  // floor upward mid-sentence, making the back half of a sentence harder
  // to detect than the front half.
  //
  // VAD false-negative hardening, ROUND 3 (2026-08-22): excluding only
  // full `candidate` samples (BOTH gates) was too narrow. Real production
  // evidence on this build (peakRms 0.359, peakNoiseFloor 0.0565 -- ~8x
  // the ~0.0068 TRUE ambient floor a prior test on a quiet room actually
  // measured) proved the floor was learning from the stylist's OWN voice,
  // not the room: amplitudeQualifiedSampleCount was only 19/100 despite a
  // healthy peakRms, while spectralQualifiedSampleCount was 69/100 --
  // meaning most samples that were genuinely speech-shaped (cleared the
  // spectral gate) still failed the amplitude gate, and under the OLD
  // `candidate`-only exclusion, every one of those (real voice, just a
  // touch quiet or mid-transition) got fed into this EMA as if it were
  // ambient noise. Since the amplitude gate is itself DERIVED FROM this
  // floor (amplitudeFloor = floor * noiseFloorMargin), this created a
  // feedback loop: real-but-imperfect speech samples raised the floor,
  // which raised the amplitude bar, which made MORE real speech fail
  // amplitude and get folded in as "ambient" too -- a floor that chases
  // the speaker's own voice upward over the course of a single recording.
  //
  // The fix excludes on `spectralQualified` alone, not the full
  // `candidate`: spectral concentration in the speech band is this
  // module's own most voice-specific signal (see the module doc comment
  // on why it was added at all) and is INDEPENDENT of the adaptive floor
  // -- unlike amplitude, it cannot be circularly self-reinforcing. A
  // sample whose spectral shape says "this looks like voice" must never
  // be treated as ambient evidence, regardless of how loud it was.
  // Background-music/dryer-noise rejection is untouched by this change:
  // sustained music and broadband noise are specifically the signals that
  // FAIL the spectral gate (see this module's own background-music
  // regression tests), so they still update the floor exactly as before.
  //
  // VAD false-negative hardening, ROUND 5 (2026-08-22): also exclude a
  // sample when `spectralRecentlyQualified` (computed above for
  // windowedCandidate), not only when it is spectrally qualified itself
  // -- see this module's own ROUND 5 doc comment for the real production
  // evidence (amplitude evidence dropped to 11/100 despite spectral
  // reaching 47/100, and peakNoiseFloor still ~12.7x a true quiet-room
  // baseline). A loud, momentarily-non-spectral sample a few samples away
  // from a spectrally-qualified neighbor (a plosive/sibilant mid-word) is
  // still real speech, not ambient noise -- reuses the exact same bounded
  // recency window already validated for windowedCandidate, not a new
  // threshold.
  const noiseFloorEstimate =
    spectralQualified || spectralRecentlyQualified
      ? state.noiseFloorEstimate
      : state.noiseFloorEstimate * (1 - config.noiseFloorAdaptRate) + sample.rmsLevel * config.noiseFloorAdaptRate;

  if (!windowedCandidate) {
    if (state.hasDetectedSpeech) {
      const silenceDuration = now - (state.lastSpeechAt ?? now);
      const nextState: VadState = { ...state, ...diagnosticAccumulators, noiseFloorEstimate, speechStreakStartedAt: null };
      if (silenceDuration >= config.silenceDurationMs) {
        return { state: nextState, decision: "stop_silence" };
      }
      return { state: nextState, decision: "continue" };
    }
    // VAD false-negative hardening (2026-08-21): a genuinely SHORT gap
    // since the last candidate-like sample no longer discards an
    // in-progress streak's accumulated progress outright -- see this
    // module's own doc comment for the real production false negative
    // this fixes. Only a gap longer than maxCandidateGapMs (or no prior
    // candidate at all this recording) actually resets it.
    //
    // VAD false-negative hardening, ROUND 5 (2026-08-22): the tolerance
    // is now Math.max(maxCandidateGapMs, speechEvidenceWindowMs), not
    // maxCandidateGapMs alone. Real production evidence (candidateResetCount:
    // 3, maxCandidateSpeechMs capped at 191ms despite windowedCandidateSampleCount:
    // 7) traced to a genuine, code-provable inconsistency: windowedCandidate
    // itself already treats cross-modal evidence as "fresh" for up to
    // speechEvidenceWindowMs (300ms, see ROUND 4), but this streak-survival
    // check was still gated on the OLDER, tighter maxCandidateGapMs
    // (150ms, calibrated in round 1 for the very different same-sample-AND
    // world) -- so two windowedCandidate=true samples 150-300ms apart,
    // BOTH individually still valid per windowedCandidate's own recency
    // logic, could still have their streak discarded between them by this
    // stricter, now-inconsistent bound. Deriving the tolerance from
    // whichever of the two named config values is larger keeps both
    // fields meaningful (neither is deleted or blindly bumped) while
    // making the streak's own survival rule consistent with what
    // windowedCandidate already promises.
    const gapSinceLastCandidate = now - (state.lastSpeechAt ?? -Infinity);
    const streakSurvives =
      state.speechStreakStartedAt !== null &&
      gapSinceLastCandidate <= Math.max(config.maxCandidateGapMs, config.speechEvidenceWindowMs);
    const candidateResetCount =
      state.speechStreakStartedAt !== null && !streakSurvives ? state.candidateResetCount + 1 : state.candidateResetCount;
    const elapsedSinceStart = now - state.recordingStartedAt;
    const nextState: VadState = {
      ...state,
      ...diagnosticAccumulators,
      noiseFloorEstimate,
      candidateResetCount,
      speechStreakStartedAt: streakSurvives ? state.speechStreakStartedAt : null,
    };
    if (elapsedSinceStart >= config.noSpeechTimeoutMs) {
      return { state: nextState, decision: "stop_no_speech_timeout" };
    }
    return { state: nextState, decision: "continue" };
  }

  // This sample IS a windowed candidate (ROUND 4: cross-modality evidence
  // within speechEvidenceWindowMs, not necessarily both gates on this
  // exact sample -- see this module's own ROUND 4 doc comment).
  const speechStreakStartedAt = state.speechStreakStartedAt ?? now;
  const streakDuration = now - speechStreakStartedAt;
  const hasDetectedSpeech = state.hasDetectedSpeech || streakDuration >= config.minSpeechDurationMs;

  return {
    state: {
      ...state,
      ...diagnosticAccumulators,
      noiseFloorEstimate,
      speechStreakStartedAt,
      hasDetectedSpeech,
      lastSpeechAt: now,
      maxCandidateStreakMs: Math.max(state.maxCandidateStreakMs, streakDuration),
      // Strict SAME-SAMPLE meaning preserved (see this field's own doc
      // comment) -- only increments when BOTH gates passed on this exact
      // sample (`candidate`), not merely when windowedCandidate is true.
      fullyQualifiedSampleCount: candidate ? state.fullyQualifiedSampleCount + 1 : state.fullyQualifiedSampleCount,
    },
    decision: "continue",
  };
}

// The auto-submit gate: after a recording ends (whether by VAD auto-stop
// or a manual Stop click) and finishes transcribing, this is the ONLY
// thing that decides whether to fire off the chat send -- a transcription
// FAILURE never reaches this function at all (finishRecording's onFailure
// path is structurally separate from onSuccess, see
// teach-ai-panel-logic.ts), and an empty/whitespace-only transcript
// (should the backend ever somehow return one) is explicitly rejected
// here too, so "STT eșuează -> zero submit" and "transcript gol -> zero
// submit" both hold by construction, not by convention.
export function shouldAutoSubmitTranscript(transcript: string | null | undefined): boolean {
  return typeof transcript === "string" && transcript.trim().length > 0;
}

// End-of-speech hardening (2026-08-20), Task E: telemetry sufficient to
// later see WHY a recording ended, without ever storing raw audio or
// conversation content. `manual_stop` is not a VadDecision (evaluateVadSample
// never produces it) -- it is recorded separately, by the caller, the
// moment a manual Stop click wins the race against VAD's own interval.
export type VoiceActivityAutoStopReason = VadDecision | "manual_stop";

export interface VoiceActivityDiagnostics {
  autoStopReason: VoiceActivityAutoStopReason | null;
  recordingDurationMs: number | null;
  // The span from the moment speech was first CONFIRMED (see
  // minSpeechDurationMs) to the last sample that still counted as speech --
  // an approximation of "how long the stylist was actually talking", not a
  // frame-perfect measurement. Null whenever speech was never confirmed at
  // all (e.g. stop_no_speech_timeout, or music-only per this round's fix).
  speechDurationMs: number | null;
  // Only ever populated for autoStopReason === "stop_silence" -- for every
  // other reason this app has no honest claim about "silence after
  // speech" to make, so it stays null rather than reporting a number that
  // doesn't mean what its name promises.
  silenceAfterSpeechMs: number | null;
  // Offsets from recording start (never an absolute wall-clock timestamp,
  // matching this app's existing telemetry privacy convention) -- lets an
  // operator reconstruct the shape of a turn (how long before speech
  // started, how long it lasted) without ever knowing what was actually said.
  speechDetectedAtMs: number | null;
  speechEndedAtMs: number | null;
  maxDurationTriggered: boolean;
  // Identifies which VAD algorithm version produced this report -- see
  // use-voice-recording.ts's own VAD_MODE constant.
  vadMode: string;
  // VAD false-negative hardening (2026-08-21): diagnostic-only, never
  // used by evaluateVadSample's own decisions -- lets a real production
  // report distinguish WHY speech went unconfirmed (too quiet vs
  // spectrally rejected vs noise floor too high vs the streak repeatedly
  // resetting vs genuinely no speech at all) without ever needing the raw
  // audio. Always a real number (0 is a truthful "never observed", not a
  // placeholder) whenever VAD ran at all for this attempt.
  //
  // The loudest single sample observed, regardless of whether it ever
  // passed the spectral gate -- near-zero here means "too quiet ever
  // reached the mic", ruling that out if it's healthy.
  peakRms: number;
  // The highest speech-band energy concentration observed (0..1),
  // regardless of amplitude -- if this never approaches minSpeechBandRatio
  // despite a healthy peakRms, spectral rejection (not loudness) was the
  // bottleneck.
  peakSpeechBandRatio: number;
  // The adaptive noise floor's own final value -- an elevated floor here
  // (relative to peakRms) suggests the amplitude gate itself climbed too
  // high, e.g. from quiet speech at the very start of a recording being
  // mistaken for ambient noise before any candidate ever registered.
  finalNoiseFloor: number;
  // The longest UNBROKEN (post-tolerance) candidate streak this recording
  // ever reached, whether or not it actually crossed minSpeechDurationMs
  // and got confirmed -- directly answers "how close did we get". A value
  // close to but under minSpeechDurationMs, on a recording that never
  // confirmed speech, points squarely at the streak-duration/tolerance
  // mechanism rather than either threshold.
  maxCandidateSpeechMs: number;
  // How many times an in-progress (not yet confirmed) candidate streak
  // was discarded because the gap since the last candidate sample
  // exceeded maxCandidateGapMs -- a high count on a recording that never
  // confirmed speech means detection was repeatedly starting and
  // resetting, not simply never triggering at all.
  candidateResetCount: number;
  // Total count of samples, across the whole recording, that passed BOTH
  // gates (regardless of whether they contributed to a confirmed streak)
  // -- the aggregate amount of genuine speech-like evidence observed.
  fullyQualifiedSampleCount: number;
  // VAD false-negative hardening, ROUND 2 (2026-08-22): see this module's
  // own ROUND 2 doc comment for the real production evidence that showed
  // round 1's own gap-tolerance fix (still) insufficient, and exactly
  // what these answer that the round-1 fields alone couldn't.
  //
  // Total samples evaluated across the whole recording -- the denominator
  // for interpreting amplitudeQualifiedSampleCount/
  // spectralQualifiedSampleCount/fullyQualifiedSampleCount as rates.
  totalSampleCount: number;
  // How many samples cleared the amplitude gate alone, regardless of
  // spectral ratio -- a LOW value relative to totalSampleCount, on a
  // recording with a healthy peakRms, points at the adaptive floor
  // itself being too high somewhere mid-recording (see peakNoiseFloor).
  amplitudeQualifiedSampleCount: number;
  // How many samples cleared the spectral-ratio gate alone, regardless of
  // amplitude -- a LOW value relative to totalSampleCount, despite a
  // healthy peakSpeechBandRatio, means genuine speech's instantaneous
  // spectral concentration is volatile frame-to-frame (sibilants,
  // plosives, formant transitions), not that the threshold value itself
  // is unreachable.
  spectralQualifiedSampleCount: number;
  // The largest gap ever observed BETWEEN two consecutive fully-qualified
  // (both-gates) samples -- distinct from candidateResetCount (which
  // counts how many times a streak was discarded): this shows whether
  // qualifying evidence was clustered tightly together (small value) or
  // scattered thinly across the whole recording (large value, up to
  // recordingDurationMs itself).
  longestCandidateGapMs: number;
  // The adaptive noise floor's own highest value reached at any point in
  // the recording, not just its ending value (finalNoiseFloor) -- reveals
  // a floor that spiked mid-recording (e.g. from a burst of ambient
  // noise) and then settled back down, which finalNoiseFloor alone would
  // hide.
  peakNoiseFloor: number;
  // VAD false-negative hardening, ROUND 4 (2026-08-22): see this module's
  // own ROUND 4 doc comment for the real production evidence (three
  // separate recordings, each with healthy individual-gate rates but
  // near-zero same-sample overlap) that motivated the windowed-evidence
  // confirmation model. Count of samples that qualified as a
  // windowedCandidate (cross-modality, within speechEvidenceWindowMs) --
  // compare against fullyQualifiedSampleCount (which keeps its strict
  // same-sample meaning) to see directly how much the windowed model
  // helped versus the raw same-frame overlap rate on a given recording.
  windowedCandidateSampleCount: number;
}

export function computeVoiceActivityDiagnostics(params: {
  recordingStartedAt: number;
  stopDecidedAt: number;
  speechDetectedAt: number | null;
  lastSpeechAt: number | null;
  autoStopReason: VoiceActivityAutoStopReason | null;
  vadMode: string;
  peakRms: number;
  peakSpeechBandRatio: number;
  finalNoiseFloor: number;
  maxCandidateSpeechMs: number;
  candidateResetCount: number;
  fullyQualifiedSampleCount: number;
  totalSampleCount: number;
  amplitudeQualifiedSampleCount: number;
  spectralQualifiedSampleCount: number;
  longestCandidateGapMs: number;
  peakNoiseFloor: number;
  windowedCandidateSampleCount: number;
}): VoiceActivityDiagnostics {
  const speechDetectedAtMs =
    params.speechDetectedAt !== null ? Math.max(0, Math.round(params.speechDetectedAt - params.recordingStartedAt)) : null;
  const speechEndedAtMs =
    params.lastSpeechAt !== null ? Math.max(0, Math.round(params.lastSpeechAt - params.recordingStartedAt)) : null;
  return {
    autoStopReason: params.autoStopReason,
    recordingDurationMs: Math.max(0, Math.round(params.stopDecidedAt - params.recordingStartedAt)),
    speechDurationMs:
      speechDetectedAtMs !== null && speechEndedAtMs !== null ? Math.max(0, speechEndedAtMs - speechDetectedAtMs) : null,
    silenceAfterSpeechMs:
      params.autoStopReason === "stop_silence" && params.lastSpeechAt !== null
        ? Math.max(0, Math.round(params.stopDecidedAt - params.lastSpeechAt))
        : null,
    speechDetectedAtMs,
    speechEndedAtMs,
    maxDurationTriggered: params.autoStopReason === "stop_max_duration",
    vadMode: params.vadMode,
    peakRms: params.peakRms,
    peakSpeechBandRatio: params.peakSpeechBandRatio,
    finalNoiseFloor: params.finalNoiseFloor,
    maxCandidateSpeechMs: params.maxCandidateSpeechMs,
    candidateResetCount: params.candidateResetCount,
    fullyQualifiedSampleCount: params.fullyQualifiedSampleCount,
    totalSampleCount: params.totalSampleCount,
    amplitudeQualifiedSampleCount: params.amplitudeQualifiedSampleCount,
    spectralQualifiedSampleCount: params.spectralQualifiedSampleCount,
    longestCandidateGapMs: params.longestCandidateGapMs,
    peakNoiseFloor: params.peakNoiseFloor,
    windowedCandidateSampleCount: params.windowedCandidateSampleCount,
  };
}
