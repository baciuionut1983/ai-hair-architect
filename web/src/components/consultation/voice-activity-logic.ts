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
// VAD end-of-speech hardening, ROUND 6 (2026-08-22): a real production
// test on 471570b, with the USER'S OWN GROUND TRUTH ("the microphone
// stopped while I was still speaking"), proved a NEW, distinct failure
// mode -- a false POSITIVE end-of-speech, not a false negative. Speech was
// confirmed correctly at 401ms, but lastSpeechAt stopped updating at
// 802ms and stop_silence fired 2108ms later (2910ms total), truncating
// the recording while the user kept talking. STT still transcribed real
// content (43 chars) from the audio actually captured, confirming speech
// continued into the window VAD had already given up on.
//
// Root cause, found by reading the code (Q1/Q2 from this round's own
// audit): lastSpeechAt is updated in EXACTLY ONE place in this function --
// the `windowedCandidate` branch. There is no separate mechanism for
// CONTINUATION once hasDetectedSpeech is already true; every "is the
// stylist still talking" check reuses the identical, strict cross-modal
// bar START uses (amplitude AND spectral, same sample or within
// speechEvidenceWindowMs of each other). In this recording,
// amplitudeQualifiedSampleCount was a healthy 16/29 (55%) but
// spectralQualifiedSampleCount was only 5/29 (17%) -- if the handful of
// spectral hits clustered in the initial confirmation burst (consistent
// with longestCandidateGapMs staying only 103ms THERE) and none recurred
// within speechEvidenceWindowMs of an amplitude hit for the rest of the
// recording, windowedCandidate can go silent for 2+ seconds even while
// amplitude alone shows the room is clearly not quiet -- exactly the
// "genuine absence of amplitude-OR-spectral evidence" this round's task
// distinguishes from "genuine absence of BOTH aligned within a window".
//
// Q5 answer: yes, START and CONTINUATION need separate hysteresis. START
// keeps the full, unweakened cross-modal windowedCandidate bar
// unconditionally -- weakening it would reopen the very music-never-stops
// bug this whole file exists to prevent BEFORE any real speech has ever
// been confirmed. CONTINUATION (only reachable once hasDetectedSpeech is
// already true) now ALSO accepts a weaker, single-modality signal:
// `spectralQualified` alone, regardless of amplitude, refreshes
// lastSpeechAt once real speech is already underway. This is deliberately
// NOT "amplitude alone" -- amplitude alone is structurally satisfiable by
// sustained music/noise indefinitely (that is the entire reason the
// spectral gate exists at all), so it is NEVER used as a sole continuation
// signal, at START or CONTINUATION, this round or any other. Spectral
// concentration alone, by contrast, is this module's own most voice-
// specific signal and is NEVER satisfied by sustained non-vocal sources
// (see this module's own background-music regression tests) -- so this
// extension cannot be exploited by music that starts AFTER real speech
// has already ended, unlike an amplitude-based extension would be. No new
// timing parameter was introduced: the existing silenceDurationMs (2000ms)
// remains the sole bound on how long any single gap in evidence -- of
// either kind -- can persist before actually stopping.
//
// New telemetry (postConfirmationSampleCount/continuationQualifiedSampleCount/
// continuationSpectralOnlySampleCount/continuationAmplitudeOnlySampleCount/
// longestPostConfirmationGapMs, see VoiceActivityDiagnostics below) was
// added THIS round, unlike round 5: unlike that round's fixes (provable
// from existing aggregates + code alone), this round cannot fully verify
// from current telemetry alone how much CONTINUATION-specific evidence
// (as opposed to pre-confirmation evidence) contributed, since all
// existing counters mix pre- and post-confirmation samples together.
// continuationAmplitudeOnlySampleCount is diagnostic-only (never affects
// any decision) -- it exists so a future round can see whether
// amplitude-only evidence during continuation is common enough to justify
// a bounded, amplitude-based extension too, without guessing.
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
//
// VAD start-detection hardening, ROUND 7 (2026-08-22): three consecutive
// real production tests on 6cd85da, in normal/quiet conditions, all
// worked correctly end to end (speech detected, stop_silence, no
// premature cutoff, continuation contributing as designed). The next
// real test, WITH background noise present, reproduced a new, distinct
// failure: START itself never confirmed. amplitudeQualifiedSampleCount
// was a healthy 30/100, but spectralQualifiedSampleCount was only 3/100,
// and even the single BEST moment in the whole 10s recording
// (vadPeakSpeechBandRatio ~0.467) barely cleared the fixed 0.45
// threshold. fullyQualifiedSampleCount was 0 and windowedCandidateSampleCount
// only 2 -- with so few individual spectral hits, cross-modal pairing
// (round 4) had almost nothing to pair with.
//
// PHASE A/B ROOT CAUSE (DSP, not a threshold-tuning problem): speechBandRatio
// is speechBandEnergy / totalEnergy, where totalEnergy sums EVERY
// frequency bin the FFT produces (0Hz to Nyquist), not just a band around
// the speech range -- at ANALYSER_FFT_SIZE=1024, the 300-3400Hz band
// covers roughly 13% of the bins, so the other ~87% of the spectrum
// (low-frequency hum/rumble, high-frequency hiss, any broadband noise
// component) all inflate the DENOMINATOR without inflating the
// numerator. This is mathematically inevitable for ANY broadband
// background noise, regardless of how loud the noise is or what the
// exact threshold value is set to -- genuine speech mixed with such
// noise gets its own in-band concentration diluted, sample by sample.
// This directly explains the production shape: peak ratio landing just
// barely above 0.45 (the single best moment still couldn't escape
// dilution by much) and only 3/100 samples ever clearing it at all
// (most speech moments, even genuinely loud ones per the healthy
// amplitude rate, got diluted below the fixed bar). smoothingTimeConstant
// (see ROUND 4's own finding: never set, defaults to 0.8) is a plausible
// secondary amplifier of this same dilution -- continuous background
// noise blended via temporal smoothing would bias EVERY reading toward
// the noise-heavy recent average, suppressing peak in-band moments
// specifically -- but remains unverifiable by unit test, so it is
// documented again here as a stronger candidate than in ROUND 4 (that
// round's phonetic-misalignment failure didn't clearly implicate it;
// this round's noise-dilution failure plausibly does) without being
// implemented, to keep this round's fix cleanly attributable.
//
// This confirms minSpeechBandRatio=0.45 is a SYMPTOM location, not the
// root cause: lowering it would help THIS recording but is exactly the
// "tune to pass one case" move this task was told not to make -- a
// louder or noisier room would still eventually defeat a lower fixed
// threshold too, and lowering it flatly would ALSO make it measurably
// easier for sustained music's own occasional spectral flukes to
// accumulate (the precise regression this whole file exists to prevent).
//
// PHASE C: the fix is a bounded, ADAPTIVE "spectral lift" path, directly
// analogous to the amplitude gate's own already-validated adaptive-floor
// design (noiseFloorEstimate) rather than a new, unrelated mechanism.
// `ambientSpectralRatioEstimate` (see VadState) tracks the room's own
// TYPICAL spectral concentration during genuinely uninteresting moments
// (samples that clear neither the amplitude nor the spectral gate --
// deliberately NOT excluding merely-loud samples the way the amplitude
// floor does, since loud-but-diffuse ambient noise, e.g. a dryer, is
// exactly what this baseline needs to characterize correctly, not
// exclude). A sample can now ALSO qualify spectrally by clearing the
// room's own ambient baseline by a meaningful margin
// (spectralLiftMargin), rather than only the fixed absolute threshold --
// but ONLY once the baseline itself is meaningfully elevated
// (spectralLiftActivationThreshold), and ONLY down to a hard floor
// (minSpeechBandRatioFloor) well below 0.45. This guarantees the lift
// path is a NO-OP in the exact quiet/clean conditions the three prior
// successful tests already relied on (ambient baseline stays near 0,
// activation never engages) -- it can only ever ADD qualification in
// demonstrably noisy conditions, never remove it, and never below the
// hard floor.
//
// Scope: START ONLY, exactly as this round's task required. The lift
// path is explicitly gated on `!state.hasDetectedSpeech` -- once speech
// is already confirmed, ROUND 6's own continuation rule governs
// unchanged, and the noise floor's own exclusion condition (ROUND 3/5)
// is untouched. See startWindowedCandidate below, a strict superset of
// windowedCandidate that collapses to being IDENTICAL to it the instant
// hasDetectedSpeech becomes true.
//
// Why music/dryer noise remain safe: sustained non-vocal sources have a
// FIXED, low spectral ratio regardless of how the room's other
// characteristics evolve. The lift path requires `ratio >= ambient +
// margin` -- a POSITIVE, ADDITIVE requirement -- so a source whose own
// ratio never meaningfully exceeds generic ambient concentration (which
// describes music and broadband noise by the same acoustic reasoning
// that motivated the spectral gate's own existence) can never satisfy
// it, regardless of what the ambient baseline itself has adapted to --
// they simply never produce a ratio close enough to trigger the lift, by
// construction, the same way they never clear the absolute 0.45
// threshold today. See this round's own regression tests for direct
// proof against an artificially elevated ambient baseline, not just the
// default one.
//
// VAD start-detection hardening, ROUND 8 (2026-08-22): after 3 clean
// real production tests confirmed normal speech AND speech-over-music
// both work correctly on 7852039, a fourth real test -- INSTRUMENTAL
// MUSIC WITH NO VOICE AT ALL -- produced a false positive: START
// confirmed at 801ms and stayed "listening" for 6 real seconds.
// Crucially, vadSpectralLiftQualifiedSampleCount was 0 -- this round's
// own ROUND 7 lift path never engaged and is NOT the cause. The STRICT,
// ORIGINAL absolute spectral gate (>=0.45, unchanged since round 1) was
// satisfied directly: spectralQualifiedSampleCount 51/88 (58%), peak
// ratio 0.89, fullyQualifiedSampleCount (same-sample, both gates) 19/88.
//
// ROOT CAUSE (acoustic, not a threshold or a round-7 regression): the
// module's own founding premise -- "sustained ambient sources (music,
// hair dryers, hum) do not concentrate energy in the 300-3400Hz speech
// band the way voice does" -- is TRUE for broadband/percussive/atonal
// sources (confirmed correct across every prior round's own regression
// tests, all still passing) but FALSE for melodic/tonal instrumental
// music. 300-3400Hz is not actually voice-specific; it is the frequency
// range human hearing is most sensitive to, which is exactly why speech
// evolved to be perceptually salient there AND why melodic instruments
// (guitar, piano, lead synth, etc.) and musical mixing/mastering
// convention both concentrate a track's "presence" in that same range,
// for the same underlying psychoacoustic reason. A held chord or melodic
// line can clear the SAME absolute threshold real speech does, for the
// SAME structural reason -- not a coincidence or a mistuned number.
//
// Why this is NOT simply "the threshold needs to be higher": the
// confirmed-genuine successful test (471570b) had an EVEN HIGHER
// spectral-qualified rate (72/92, 78%) and fully-qualified rate (28/92,
// 30%) than this music false positive (58%, 22%) -- aggregate rate
// statistics, computed identically for both, cannot tell them apart; the
// music case looks LESS extreme by these numbers, not more. No fixed or
// adaptive absolute-ratio threshold, raised or lowered, can separate two
// distributions that already overlap this way in aggregate -- confirmed
// by direct comparison, not assumed.
//
// This round deliberately ships DIAGNOSTIC TELEMETRY ONLY, not a new
// confirmation algorithm, per the same Phase-D discipline as round 2:
// the well-reasoned candidate discriminator (see below) cannot yet be
// calibrated or validated without per-sample TEMPORAL data neither this
// nor any prior test has captured.
//
// CANDIDATE DIRECTION (not implemented, telemetry added to test it): a
// genuinely speech-specific signal every prior round's own module
// comments already describe but never formally measured -- sibilants,
// plosives, and formant transitions make real speech's spectral
// concentration VOLATILE at ~50-150ms granularity (phoneme rate), while
// a held musical note or chord stays spectrally concentrated
// CONTINUOUSLY for as long as the note sustains (often hundreds of ms to
// several seconds). This predicts genuine speech should show MANY SHORT
// unbroken runs of spectralQualified=true, while melodic music should
// show FEWER, LONGER unbroken runs, even at IDENTICAL aggregate
// qualification rates -- exactly the dimension aggregate counts cannot
// see. longestSpectralQualifiedRunMs/spectralQualifiedRunCount and
// longestFullyQualifiedRunMs/fullyQualifiedRunCount (see VadState/
// VoiceActivityDiagnostics below) measure this directly, using ONLY
// data already computed every sample (no new DSP, no new browser API) --
// comparing them against the EXISTING, gap-TOLERANT maxCandidateStreakMs
// will show whether a confirmed streak was built from many short,
// gap-bridged bursts (speech-like) or one genuinely continuous stretch
// that never needed gap tolerance at all (music-like). Deliberately NOT
// used to gate any decision this round -- the right run-length boundary
// between "a real sustained vowel" and "a held musical note" is not yet
// known, and guessing it risks exactly the "ajustare speculativă" this
// round was explicitly told not to make, in either direction (too
// permissive still lets music through; too strict could reject a
// genuine, unhurried speaker).
//
// VAD start-detection hardening, ROUND 9 (2026-08-23): a follow-up real
// production test on ea1c112 (ROUND 8's telemetry live), again pure
// instrumental music with confirmed zero human voice, reproduced the
// SAME false positive (START confirmed at 402ms) -- but this time the
// new run-length telemetry answers ROUND 8's own open question directly,
// and the answer is NOT what ROUND 8 hypothesized. spectralLiftQualifiedSampleCount
// was 0 (round 7's lift path is again not the cause). spectralQualifiedSampleCount
// was only 1/25, fullyQualifiedSampleCount 1/25, and -- the decisive new
// data -- longestSpectralQualifiedRunMs was 0 with spectralQualifiedRunCount
// 1, and longestFullyQualifiedRunMs 0 with fullyQualifiedRunCount 1. This
// is the OPPOSITE of round 8's "held note = one LONG run" prediction: the
// music here produced the SHORTEST possible run -- a single, isolated,
// non-repeating 100ms sample -- not a sustained one. ROUND 8's specific
// temporal-continuity hypothesis (long sustained runs = music, many short
// runs = speech) is REFUTED by this test as the explanation for THIS
// failure mode; a different, independently demonstrable mechanism is
// responsible instead.
//
// ROOT CAUSE (demonstrated directly from evaluateVadSample below, not
// inferred from aggregate rates): windowedCandidate/startWindowedCandidate
// (ROUND 4/7) let ONE spectral qualification "vouch" for OTHER, merely
// amplitude-qualified samples up to speechEvidenceWindowMs (300ms) away in
// EITHER direction, via the `amplitudeQualified && spectralRecentlyQualified`
// (or its START-only equivalent) clause. In this recording, exactly ONE
// sample was ever spectrally qualified; the other 3 of the 4 recorded
// windowedCandidateSampleCount hits carried NO spectral evidence of their
// own -- they qualified purely because they fell within 300ms of that
// single spectral instant and were independently amplitude-qualified
// (amplitudeQualifiedSampleCount was 8/25). Those 4 hits, spread across
// ~297ms (vadMaxCandidateSpeechMs), were enough to cross minSpeechDurationMs
// (250ms) via the existing gap-tolerant streak machinery (ROUND 1/5) and
// flip hasDetectedSpeech at 402ms -- exactly reproducing the report's
// speechDetectedAtMs/speechEndedAtMs both landing on 402ms (that streak's
// last-ever windowedCandidate hit; no further evidence ever arrived, so
// lastSpeechAt never advanced past it before stop_silence fired 2108ms
// later). This is fully mechanical and reproducible from the code and the
// telemetry alone -- no guessing was required. It also reveals the
// cross-modal window (designed in ROUND 4 to bridge ONE alternating
// phoneme's loud/narrow-band moments within a single syllable) being used
// here for something it was never intended to do: retroactively and
// prospectively "laundering" a single coincidental spectral spike (a
// percussive transient, a chord onset, a brief mixing artifact) across
// up to ~600ms of otherwise-unrelated, purely-amplitude evidence.
//
// FAZA B DECISION: yes, this test is sufficient -- the mechanism is
// demonstrated from the code, not merely correlated from aggregate rates
// (which ROUND 8 already proved cannot discriminate this case). START can
// be, and here was, confirmed from evidence that is genuinely too
// fragmented: a single, non-recurring instant of the module's own most
// voice-specific signal (spectral concentration), amplified by a window
// mechanism into a multi-sample streak with no OTHER independent spectral
// corroboration anywhere in it.
//
// THE FIX: require the START streak to contain at least
// minStartSpectralHitCount (2) DISTINCT samples that individually clear
// the spectral gate for START purposes (spectralQualifiedForStart, so
// ROUND 7's lift path still counts) before hasDetectedSpeech is allowed
// to flip true -- in addition to, not instead of, the existing
// minSpeechDurationMs streak-duration requirement. 2 is not a value fitted
// to this test: it is the smallest count that can express "this evidence
// recurred" at all -- 1 occurrence is, by construction, indistinguishable
// from a single isolated transient (a click, an onset, a coincidental
// spike), and no amount of duration or amplitude corroboration around it
// changes that. This is a NEW, independent requirement alongside the
// existing gap-tolerant streak/window machinery, not a reversion of it:
// windowedCandidate, startWindowedCandidate, the cross-modal recency
// window, and the gap-tolerant streak survival rule are all UNCHANGED --
// still exactly as validated by rounds 4-7's own real production
// evidence for genuine speech and speech-over-noise. Only the FINAL gate
// on flipping hasDetectedSpeech gains a second, independent condition.
//
// Why genuine speech is not put at risk: every documented genuine-speech
// production success this file's own history has real numbers for shows
// spectral qualification rates from 17% (round 6) up to 78% (471570b) of
// the WHOLE recording -- orders of magnitude above the single-instant
// case this round's failure produced (4% of a short clip, and the ONLY
// spectral hit in it). A streak spanning enough samples to reach
// minSpeechDurationMs (250ms, roughly 2-3 sampling intervals at the
// 100ms polling rate) drawn from a recording with a genuine, recurring
// spectral signal will overwhelmingly contain more than one spectrally-
// qualified sample; the practical effect on real speech is, at most, a
// short additional delay (a few hundred ms) waiting for a second
// qualifying instant to arrive within the SAME already-tolerant window/
// gap machinery -- never an outright rejection, since the streak is not
// discarded while it survives, only withheld from confirming. This is a
// strictly MORE conservative START, exactly as this round's task
// required, and does not touch CONTINUATION (round 6's own, separately
// gated spectral-alone rule, reachable only once hasDetectedSpeech is
// already true) or the noise-floor adaptation (rounds 3/5), both of
// which remain exactly as they were.
//
// Why a sustained single musical note/chord is a DIFFERENT, out-of-scope
// problem, correctly left alone: a note held continuously for >= 250ms
// produces MULTIPLE consecutive same-frame-qualified samples (satisfying
// the ORIGINAL, unchanged same-frame `candidate` path directly, no window
// needed) -- each one independently spectrally qualified, so it already
// satisfies minStartSpectralHitCount>=2 today, exactly as it already
// satisfied every earlier round's own logic. This was already an
// acknowledged, unsolved acoustic-overlap limitation of a 2-signal
// classifier (see ROUND 8's own "why this is NOT simply the threshold
// needs to be higher" finding) BEFORE this round, is not what this
// round's own real test demonstrated (spectralQualifiedRunCount was 1,
// not a long sustained run), and is not solved or worsened by this
// round's fix -- solving it would require a materially different signal
// (e.g. pitch/harmonicity analysis) this codebase does not have, not a
// count-of-recurrences check. Documented here, again, as a known
// limitation rather than patched speculatively.
//
// What was explicitly NOT done: no existing threshold (minSpeechBandRatio,
// noiseFloorMargin, spectralLiftMargin/Activation) was raised or lowered;
// no existing gap-tolerance or window value (maxCandidateGapMs,
// speechEvidenceWindowMs) was changed; CONTINUATION's own rule and the
// noise floor's own exclusion condition were not touched; no run-length-
// in-milliseconds boundary was invented (ROUND 8's own run-length
// hypothesis, refuted above as the mechanism for THIS failure, is left as
// telemetry only, exactly as before -- this round's fix uses a plain
// per-streak COUNT of qualifying samples, not run duration, since the
// demonstrated failure was about the ABSENCE of a second qualifying
// instant, not about how long any one run lasted).

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
  // VAD start-detection hardening, ROUND 7 (2026-08-22): the room's own
  // adaptive ambient spectral ratio (see VadState.ambientSpectralRatioEstimate)
  // must reach at least this before the START-only spectral "lift" path
  // engages at all -- keeps the lift a strict no-op in the quiet/clean
  // conditions the fixed 0.45 threshold already handles correctly (a
  // near-silent room's ambient baseline stays near 0, well under this).
  // See this module's own ROUND 7 doc comment for the full DSP root
  // cause and design.
  spectralLiftActivationThreshold: number;
  // How much MORE concentrated a sample's spectral ratio must be than the
  // room's own current ambient baseline for the START-only lift path to
  // qualify it -- a positive, additive margin, not a lowered threshold.
  // Sustained music/broadband noise's own ratio never meaningfully
  // exceeds generic ambient concentration, so it can never satisfy this,
  // regardless of what the ambient baseline itself has adapted to.
  spectralLiftMargin: number;
  // Hard absolute floor for the START-only lift path -- well below
  // minSpeechBandRatio, but never zero, so an extremely diluted or
  // spurious reading can never qualify purely from a low ambient
  // baseline plus a technically-satisfied margin.
  minSpeechBandRatioFloor: number;
  // VAD start-detection hardening, ROUND 9 (2026-08-23): the minimum
  // number of DISTINCT samples, within the currently-forming START
  // streak, that must individually clear the spectral gate
  // (spectralQualifiedForStart) before the streak may actually flip
  // hasDetectedSpeech -- in addition to, not instead of,
  // minSpeechDurationMs. See this module's own ROUND 9 doc comment for
  // the real production false positive this closes (a single, isolated
  // spectral instant laundered into a full streak purely via the
  // cross-modal recency window). Not a fitted/tuned acoustic threshold --
  // 2 is the smallest count that can express "this evidence recurred at
  // all"; 1 is, by construction, a single isolated instant.
  minStartSpectralHitCount: number;
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
  spectralLiftActivationThreshold: 0.15,
  spectralLiftMargin: 0.15,
  minSpeechBandRatioFloor: 0.3,
  minStartSpectralHitCount: 2,
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
  // VAD end-of-speech hardening, ROUND 6 (2026-08-22): the timestamp of
  // the most recent sample that was a full windowedCandidate specifically
  // -- kept SEPARATE from lastSpeechAt (which, from this round on, can
  // also be refreshed by the weaker continuation-only spectral-alone
  // signal) so longestCandidateGapMs keeps its own established meaning
  // (gap between full cross-modal hits) unchanged. See this module's own
  // ROUND 6 doc comment.
  lastWindowedCandidateAt: number | null;
  // Total samples evaluated AFTER hasDetectedSpeech first became true --
  // the denominator for the continuation-specific counters below.
  postConfirmationSampleCount: number;
  // How many post-confirmation samples refreshed lastSpeechAt, via EITHER
  // a full windowedCandidate or the new continuation-only spectral-alone
  // rule -- compare against postConfirmationSampleCount to see how
  // reliably continuation evidence was found on a given recording.
  continuationQualifiedSampleCount: number;
  // Of the above, how many qualified SPECIFICALLY via the new
  // continuation-only rule (spectralQualified alone, windowedCandidate
  // false) -- shows directly how much this round's fix itself
  // contributed, distinct from evidence windowedCandidate already covered.
  continuationSpectralOnlySampleCount: number;
  // Diagnostic-only, NEVER used by any decision in this file: how many
  // post-confirmation samples were amplitude-qualified but NOT spectrally
  // qualified and not already a windowedCandidate -- real evidence this
  // round's fix still discards, kept visible so a future round can see
  // whether a bounded amplitude-based extension is also justified,
  // without guessing.
  continuationAmplitudeOnlySampleCount: number;
  // The largest gap ever seen, AFTER confirmation, between two consecutive
  // samples that refreshed lastSpeechAt (by either mechanism) -- the
  // post-confirmation analogue of longestCandidateGapMs, which only ever
  // measures gaps between full windowedCandidate hits.
  longestPostConfirmationGapMs: number;
  // VAD start-detection hardening, ROUND 7 (2026-08-22): exponential
  // moving average of the room's own TYPICAL spectral concentration
  // during genuinely uninteresting moments (samples clearing NEITHER the
  // amplitude nor the spectral gate) -- see this module's own ROUND 7 doc
  // comment for why this is deliberately NOT excluded on loudness alone
  // (unlike noiseFloorEstimate), so it correctly learns a loud-but-
  // diffuse source's (a dryer's) own low ratio rather than staying stale.
  // Starts at 0; the lift path itself only engages once this reaches
  // spectralLiftActivationThreshold, so a near-silent room's behavior is
  // completely unaffected.
  ambientSpectralRatioEstimate: number;
  // The highest ambientSpectralRatioEstimate ever reached this recording
  // -- the spectral-ratio analogue of peakNoiseFloor, revealing a
  // baseline that spiked and later settled, which the final value alone
  // would hide.
  peakAmbientSpectralRatioEstimate: number;
  // The timestamp of the most recent sample that qualified spectrally for
  // START purposes specifically (absolute OR lift-qualified) -- kept
  // SEPARATE from lastSpectralQualifiedAt (which stays strictly absolute-
  // threshold-only, still driving the noise floor's own exclusion and
  // ROUND 6's continuation rule, both unaffected by this round).
  lastSpectralQualifiedAtForStart: number | null;
  // How many samples qualified spectrally SPECIFICALLY via the new
  // START-only lift path (not the absolute 0.45 threshold) -- shows
  // directly how much this round's fix contributed on a given recording.
  spectralLiftQualifiedSampleCount: number;
  // VAD start-detection hardening, ROUND 8 (2026-08-22): diagnostic-only
  // (never gates any decision) -- see this module's own ROUND 8 doc
  // comment for the real production evidence (instrumental music with no
  // voice satisfying the strict spectral gate at rates aggregate stats
  // cannot distinguish from genuine speech) and the temporal-continuity
  // hypothesis this data is designed to test. When the current sample
  // extends an unbroken run, null otherwise (the run just ended/never
  // started).
  spectralRunStartedAt: number | null;
  // The longest unbroken (ZERO gap tolerance -- unlike the existing,
  // gap-TOLERANT maxCandidateStreakMs) run of consecutive
  // spectralQualified=true samples this recording -- a held musical note
  // or chord is hypothesized to produce one long run; real speech's own
  // phoneme-rate volatility is hypothesized to produce many short ones.
  longestSpectralQualifiedRunMs: number;
  // How many DISTINCT such runs occurred (each gap, however brief, ends
  // one run and starts counting toward the next) -- compare against
  // spectralQualifiedSampleCount / spectralQualifiedRunCount for the
  // average run length, and against longestSpectralQualifiedRunMs for
  // whether qualifying evidence was scattered or clustered.
  spectralQualifiedRunCount: number;
  // Same run-tracking, but for `candidate` (BOTH gates on the identical
  // sample, the strictest possible per-sample test) instead of spectral
  // alone -- shows whether the samples that fed fullyQualifiedSampleCount
  // came in one continuous stretch or many short ones.
  fullyQualifiedRunStartedAt: number | null;
  longestFullyQualifiedRunMs: number;
  fullyQualifiedRunCount: number;
  // VAD start-detection hardening, ROUND 9 (2026-08-23): how many DISTINCT
  // samples, since the CURRENTLY-ALIVE start streak began (reset exactly
  // when speechStreakStartedAt itself resets), individually cleared the
  // spectral gate for START purposes (spectralQualifiedForStart) -- see
  // minStartSpectralHitCount's own doc comment. Deliberately scoped to the
  // streak, unlike spectralQualifiedSampleCount (whole-recording, never
  // resets) -- this is what actually gates confirmation.
  streakSpectralHitCount: number;
  // The highest streakSpectralHitCount ever reached this recording, even
  // after a later reset -- lets a real production report see directly how
  // much spectral recurrence the longest-forming streak actually had,
  // without needing to infer it from whether hasDetectedSpeech ever
  // flipped true.
  peakStreakSpectralHitCount: number;
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
    lastWindowedCandidateAt: null,
    postConfirmationSampleCount: 0,
    continuationQualifiedSampleCount: 0,
    continuationSpectralOnlySampleCount: 0,
    continuationAmplitudeOnlySampleCount: 0,
    longestPostConfirmationGapMs: 0,
    ambientSpectralRatioEstimate: 0,
    peakAmbientSpectralRatioEstimate: 0,
    lastSpectralQualifiedAtForStart: null,
    spectralLiftQualifiedSampleCount: 0,
    spectralRunStartedAt: null,
    longestSpectralQualifiedRunMs: 0,
    spectralQualifiedRunCount: 0,
    fullyQualifiedRunStartedAt: null,
    longestFullyQualifiedRunMs: 0,
    fullyQualifiedRunCount: 0,
    streakSpectralHitCount: 0,
    peakStreakSpectralHitCount: 0,
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
  const lastWindowedCandidateAt = windowedCandidate ? now : state.lastWindowedCandidateAt;

  // VAD start-detection hardening, ROUND 7 (2026-08-22): a START-only
  // spectral "lift" path -- see this module's own ROUND 7 doc comment for
  // the real production evidence (background noise dilutes the spectral
  // ratio's own denominator, so genuine speech-over-noise rarely reaches
  // the fixed 0.45 threshold) and the full safety argument. Deliberately
  // NOT excluded on loudness alone (unlike noiseFloorEstimate) -- a loud
  // but spectrally diffuse source (a dryer) needs to correctly update
  // this baseline too, not be treated as an unknown.
  const isPureAmbientSample = !amplitudeQualified && !spectralQualified;
  const ambientSpectralRatioEstimate = isPureAmbientSample
    ? state.ambientSpectralRatioEstimate * (1 - config.noiseFloorAdaptRate) + sample.speechBandRatio * config.noiseFloorAdaptRate
    : state.ambientSpectralRatioEstimate;
  const spectralLiftQualified =
    !state.hasDetectedSpeech &&
    state.ambientSpectralRatioEstimate >= config.spectralLiftActivationThreshold &&
    sample.speechBandRatio >= state.ambientSpectralRatioEstimate + config.spectralLiftMargin &&
    sample.speechBandRatio >= config.minSpeechBandRatioFloor;
  const spectralQualifiedForStart = spectralQualified || spectralLiftQualified;
  const lastSpectralQualifiedAtForStart = spectralQualifiedForStart ? now : state.lastSpectralQualifiedAtForStart;
  // Identical cross-modal structure to windowedCandidate above, but using
  // spectralQualifiedForStart (accepts the lift path) in place of the
  // strict spectralQualified. Always >= windowedCandidate, and IDENTICAL
  // to it the instant hasDetectedSpeech becomes true (spectralLiftQualified
  // is itself gated on !state.hasDetectedSpeech) -- a pure widening of
  // START's own evidence, never CONTINUATION's or the noise floor's.
  const spectralRecentlyQualifiedForStart =
    state.lastSpectralQualifiedAtForStart !== null && now - state.lastSpectralQualifiedAtForStart <= config.speechEvidenceWindowMs;
  const startWindowedCandidate =
    (amplitudeQualified && spectralQualifiedForStart) ||
    (amplitudeQualified && spectralRecentlyQualifiedForStart) ||
    (spectralQualifiedForStart && amplitudeRecentlyQualified);

  // VAD end-of-speech hardening, ROUND 6 (2026-08-22): CONTINUATION-only
  // evidence -- see this module's own ROUND 6 doc comment for the real
  // production ground truth (mic stopped while the user kept talking) and
  // why START and CONTINUATION need separate hysteresis. Only meaningful
  // once hasDetectedSpeech is already true: `spectralQualified` alone,
  // regardless of amplitude, is credible enough evidence that a real,
  // already-confirmed utterance is still ongoing. Deliberately NOT
  // amplitude alone -- amplitude alone is satisfiable by sustained music
  // indefinitely, so it is never used as a sole continuation signal.
  const continuationQualified = state.hasDetectedSpeech && spectralQualified;
  // Diagnostic-only (see this field's own VadState doc comment) -- never
  // read by any decision below.
  const isContinuationAmplitudeOnly = state.hasDetectedSpeech && amplitudeQualified && !spectralQualified && !windowedCandidate;
  // The single signal that now governs whether THIS sample keeps an
  // utterance (START or CONFIRMED) from timing out. ROUND 7: uses
  // startWindowedCandidate (a strict superset of windowedCandidate,
  // identical to it once hasDetectedSpeech is true), not windowedCandidate
  // directly -- widens what counts as evidence pre-confirmation (the
  // lift path) without changing anything post-confirmation, where
  // continuationQualified's own rule (ROUND 6) governs unchanged.
  const speechRefresh = startWindowedCandidate || continuationQualified;

  // VAD false-negative hardening (2026-08-21 / ROUND 2 2026-08-22 / ROUND
  // 4 2026-08-22) diagnostic accumulators -- tracked unconditionally,
  // every sample, regardless of candidate status. See
  // VoiceActivityDiagnostics's own doc comments for what each answers.
  const peakRms = Math.max(state.peakRms, sample.rmsLevel);
  const peakSpeechBandRatio = Math.max(state.peakSpeechBandRatio, sample.speechBandRatio);
  const peakNoiseFloor = Math.max(state.peakNoiseFloor, state.noiseFloorEstimate);
  const peakAmbientSpectralRatioEstimate = Math.max(state.peakAmbientSpectralRatioEstimate, state.ambientSpectralRatioEstimate);
  const totalSampleCount = state.totalSampleCount + 1;
  const amplitudeQualifiedSampleCount = amplitudeQualified ? state.amplitudeQualifiedSampleCount + 1 : state.amplitudeQualifiedSampleCount;
  const spectralQualifiedSampleCount = spectralQualified ? state.spectralQualifiedSampleCount + 1 : state.spectralQualifiedSampleCount;
  const windowedCandidateSampleCount = windowedCandidate
    ? state.windowedCandidateSampleCount + 1
    : state.windowedCandidateSampleCount;
  const spectralLiftQualifiedSampleCount = spectralLiftQualified
    ? state.spectralLiftQualifiedSampleCount + 1
    : state.spectralLiftQualifiedSampleCount;
  // The largest gap ever seen BETWEEN two consecutive windowed-candidate
  // samples -- distinct from candidateResetCount (which only counts how
  // many times a streak was discarded): this measures how far apart in
  // real time qualifying evidence actually was, regardless of whether a
  // streak was in progress. Only updated when THIS sample is itself a
  // windowed candidate and a prior one exists. ROUND 6: now measured
  // against lastWindowedCandidateAt, not lastSpeechAt (which can also be
  // refreshed by the weaker continuation-only rule from this round on) --
  // keeps this field's own established meaning unchanged.
  const longestCandidateGapMs =
    windowedCandidate && state.lastWindowedCandidateAt !== null
      ? Math.max(state.longestCandidateGapMs, now - state.lastWindowedCandidateAt)
      : state.longestCandidateGapMs;
  // ROUND 6 continuation-specific accumulators -- see this module's own
  // ROUND 6 doc comment and VoiceActivityDiagnostics's own doc comments
  // for what each answers. All gated on state.hasDetectedSpeech (i.e.
  // pre-confirmation samples never contribute), matching the STT-visible
  // "already an ongoing utterance" scope these fields describe.
  const postConfirmationSampleCount = state.hasDetectedSpeech ? state.postConfirmationSampleCount + 1 : state.postConfirmationSampleCount;
  const continuationQualifiedSampleCount =
    state.hasDetectedSpeech && speechRefresh ? state.continuationQualifiedSampleCount + 1 : state.continuationQualifiedSampleCount;
  const continuationSpectralOnlySampleCount =
    continuationQualified && !windowedCandidate ? state.continuationSpectralOnlySampleCount + 1 : state.continuationSpectralOnlySampleCount;
  const continuationAmplitudeOnlySampleCount = isContinuationAmplitudeOnly
    ? state.continuationAmplitudeOnlySampleCount + 1
    : state.continuationAmplitudeOnlySampleCount;
  const longestPostConfirmationGapMs =
    state.hasDetectedSpeech && speechRefresh && state.lastSpeechAt !== null
      ? Math.max(state.longestPostConfirmationGapMs, now - state.lastSpeechAt)
      : state.longestPostConfirmationGapMs;
  // VAD start-detection hardening, ROUND 8 (2026-08-22): diagnostic-only
  // run-length tracking -- see this module's own ROUND 8 doc comment for
  // the temporal-continuity hypothesis this data is designed to test.
  // ZERO gap tolerance by construction (any single non-qualifying sample
  // ends the run), unlike the existing, gap-TOLERANT maxCandidateStreakMs.
  const spectralRunStartedAt = spectralQualified ? (state.spectralRunStartedAt ?? now) : null;
  const longestSpectralQualifiedRunMs = spectralQualified
    ? Math.max(state.longestSpectralQualifiedRunMs, now - (spectralRunStartedAt as number))
    : state.longestSpectralQualifiedRunMs;
  const spectralQualifiedRunCount =
    spectralQualified && state.spectralRunStartedAt === null ? state.spectralQualifiedRunCount + 1 : state.spectralQualifiedRunCount;
  const fullyQualifiedRunStartedAt = candidate ? (state.fullyQualifiedRunStartedAt ?? now) : null;
  const longestFullyQualifiedRunMs = candidate
    ? Math.max(state.longestFullyQualifiedRunMs, now - (fullyQualifiedRunStartedAt as number))
    : state.longestFullyQualifiedRunMs;
  const fullyQualifiedRunCount =
    candidate && state.fullyQualifiedRunStartedAt === null ? state.fullyQualifiedRunCount + 1 : state.fullyQualifiedRunCount;
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
    lastWindowedCandidateAt,
    postConfirmationSampleCount,
    continuationQualifiedSampleCount,
    continuationSpectralOnlySampleCount,
    continuationAmplitudeOnlySampleCount,
    longestPostConfirmationGapMs,
    ambientSpectralRatioEstimate,
    peakAmbientSpectralRatioEstimate,
    lastSpectralQualifiedAtForStart,
    spectralLiftQualifiedSampleCount,
    spectralRunStartedAt,
    longestSpectralQualifiedRunMs,
    spectralQualifiedRunCount,
    fullyQualifiedRunStartedAt,
    longestFullyQualifiedRunMs,
    fullyQualifiedRunCount,
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

  // ROUND 6: the silence countdown (below) and the START streak-survival
  // check (further below) now key on speechRefresh, not windowedCandidate
  // alone -- see this module's own ROUND 6 doc comment. Since
  // continuationQualified can only ever be true once hasDetectedSpeech is
  // already true, this is a no-op for START: speechRefresh ===
  // windowedCandidate whenever hasDetectedSpeech is still false.
  if (!speechRefresh) {
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
    // VAD start-detection hardening, ROUND 9 (2026-08-23): streakSpectralHitCount
    // shares the streak's own reset trigger exactly -- see this module's
    // own ROUND 9 doc comment and minStartSpectralHitCount's doc comment.
    const nextState: VadState = {
      ...state,
      ...diagnosticAccumulators,
      noiseFloorEstimate,
      candidateResetCount,
      speechStreakStartedAt: streakSurvives ? state.speechStreakStartedAt : null,
      streakSpectralHitCount: streakSurvives ? state.streakSpectralHitCount : 0,
    };
    if (elapsedSinceStart >= config.noSpeechTimeoutMs) {
      return { state: nextState, decision: "stop_no_speech_timeout" };
    }
    return { state: nextState, decision: "continue" };
  }

  if (startWindowedCandidate) {
    // This sample IS a start-eligible windowed candidate (ROUND 4:
    // cross-modality evidence within speechEvidenceWindowMs, not
    // necessarily both gates on this exact sample; ROUND 7: OR the
    // START-only spectral lift path -- see those rounds' own doc
    // comments). The ONLY path that can progress the START streak or
    // flip hasDetectedSpeech -- ROUND 6's weaker continuation signal
    // never touches this branch (see the `else` below instead). Once
    // hasDetectedSpeech is already true, startWindowedCandidate is
    // IDENTICAL to windowedCandidate (the lift path is gated off), so
    // this branch's post-confirmation behavior is completely unchanged
    // from ROUND 6.
    const speechStreakStartedAt = state.speechStreakStartedAt ?? now;
    const streakDuration = now - speechStreakStartedAt;
    // VAD start-detection hardening, ROUND 9 (2026-08-23): a second,
    // independent requirement alongside streakDuration -- see this
    // module's own ROUND 9 doc comment and minStartSpectralHitCount's own
    // doc comment for the real production false positive (a single,
    // isolated spectral instant laundered into a full duration-qualifying
    // streak purely via the cross-modal recency window below) this
    // closes. Counts DISTINCT samples in the currently-alive streak that
    // individually cleared the spectral gate for START purposes -- reset
    // to 0/1 exactly when the streak itself starts fresh (isNewStreak),
    // otherwise accumulated alongside it.
    const isNewStreak = state.speechStreakStartedAt === null;
    const streakSpectralHitCount = spectralQualifiedForStart
      ? isNewStreak
        ? 1
        : state.streakSpectralHitCount + 1
      : isNewStreak
        ? 0
        : state.streakSpectralHitCount;
    const peakStreakSpectralHitCount = Math.max(state.peakStreakSpectralHitCount, streakSpectralHitCount);
    const hasDetectedSpeech =
      state.hasDetectedSpeech ||
      (streakDuration >= config.minSpeechDurationMs && streakSpectralHitCount >= config.minStartSpectralHitCount);

    return {
      state: {
        ...state,
        ...diagnosticAccumulators,
        noiseFloorEstimate,
        speechStreakStartedAt,
        streakSpectralHitCount,
        peakStreakSpectralHitCount,
        hasDetectedSpeech,
        lastSpeechAt: now,
        maxCandidateStreakMs: Math.max(state.maxCandidateStreakMs, streakDuration),
        // Strict SAME-SAMPLE meaning preserved (see this field's own doc
        // comment) -- only increments when BOTH gates passed on this exact
        // sample using the ABSOLUTE threshold (`candidate`), never the
        // lift path -- unaffected by ROUND 7.
        fullyQualifiedSampleCount: candidate ? state.fullyQualifiedSampleCount + 1 : state.fullyQualifiedSampleCount,
      },
      decision: "continue",
    };
  }

  // ROUND 6 (2026-08-22): speechRefresh is true but startWindowedCandidate
  // is false -- by construction (continuationQualified's own condition,
  // and startWindowedCandidate === windowedCandidate once confirmed) this
  // can only happen when state.hasDetectedSpeech is already true and this
  // sample is spectrally qualified alone. Refreshes lastSpeechAt (keeps
  // the silence countdown from expiring) but deliberately does NOT touch
  // the START streak machinery (speechStreakStartedAt/maxCandidateStreakMs/
  // fullyQualifiedSampleCount) -- those describe the PRE-confirmation
  // streak-building process only, and are irrelevant once hasDetectedSpeech
  // is already true (see this module's own ROUND 6 doc comment).
  return {
    state: {
      ...state,
      ...diagnosticAccumulators,
      noiseFloorEstimate,
      lastSpeechAt: now,
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
  // VAD end-of-speech hardening, ROUND 6 (2026-08-22): see this module's
  // own ROUND 6 doc comment for the real production ground truth (mic
  // stopped mid-utterance) that motivated CONTINUATION getting its own,
  // weaker evidence rule separate from START. All null whenever
  // hasDetectedSpeech never became true this recording (there is no
  // "post-confirmation" period to describe) -- never a fabricated zero.
  //
  // Total samples evaluated after speech was first confirmed -- the
  // denominator for the two rates below.
  postConfirmationSampleCount: number | null;
  // How many post-confirmation samples refreshed the silence countdown,
  // via EITHER a full windowedCandidate or the new continuation-only
  // spectral-alone rule -- a LOW value relative to postConfirmationSampleCount
  // on a recording that still confirmed speech (hasDetectedSpeech: true)
  // but stopped early means continuation evidence was genuinely sparse.
  continuationQualifiedSampleCount: number | null;
  // Of the above, how many qualified SPECIFICALLY via the new
  // continuation-only rule (spectral alone, not a full windowedCandidate)
  // -- shows directly how much this round's fix contributed on this
  // recording, distinct from evidence windowedCandidate already covered.
  continuationSpectralOnlySampleCount: number | null;
  // Diagnostic-only, never used by any VAD decision: how many post-
  // confirmation samples were amplitude-qualified but not spectrally
  // qualified and not already a windowedCandidate -- real evidence this
  // round's fix still discards, kept visible for a future round.
  continuationAmplitudeOnlySampleCount: number | null;
  // The largest gap ever seen, after confirmation, between two consecutive
  // samples that refreshed the silence countdown (by either mechanism) --
  // the post-confirmation analogue of longestCandidateGapMs.
  longestPostConfirmationGapMs: number | null;
  // How long before the stop decision the LAST full windowedCandidate
  // (cross-modal, the "strong" signal) was observed -- distinct from
  // silenceAfterSpeechMs (which reflects the last refresh via EITHER
  // mechanism). A recording that stopped shortly after its last strong
  // hit, despite several weaker continuation-only hits after it, points
  // at cross-modal evidence specifically drying up, not all evidence.
  // Only populated for stop_silence (see silenceAfterSpeechMs's own doc
  // comment for why every other reason has no honest claim to make here).
  lastStrongEvidenceAgeAtStopMs: number | null;
  // VAD start-detection hardening, ROUND 7 (2026-08-22): see this
  // module's own ROUND 7 doc comment for the real production evidence
  // (background noise dilutes the spectral ratio's own denominator) that
  // motivated a START-only adaptive spectral "lift" path. Always a real
  // number (0 is truthful -- "never learned any ambient spectral
  // signature", not a placeholder) whenever VAD ran at all.
  //
  // The room's own final learned ambient spectral concentration --
  // compare against peakSpeechBandRatio to see how much dilution genuine
  // speech likely suffered (a peak only modestly above this baseline,
  // despite healthy amplitude evidence, points at exactly this round's
  // diagnosed mechanism).
  ambientSpectralRatioEstimate: number;
  // The highest ambientSpectralRatioEstimate reached at any point in the
  // recording, not just its ending value -- reveals a baseline that
  // spiked (e.g. from a burst of louder ambient noise) and later settled.
  peakAmbientSpectralRatioEstimate: number;
  // How many samples qualified spectrally SPECIFICALLY via the new
  // START-only lift path (not the absolute 0.45 threshold) -- shows
  // directly how much this round's fix contributed. Zero on a recording
  // where the lift path never engaged (e.g. a quiet room, where the
  // absolute threshold alone already worked) or never needed to.
  spectralLiftQualifiedSampleCount: number;
  // VAD start-detection hardening, ROUND 8 (2026-08-22): diagnostic-only,
  // never used by any VAD decision -- see this module's own ROUND 8 doc
  // comment for the real production evidence (instrumental music with no
  // voice satisfying the strict spectral gate at aggregate rates
  // indistinguishable from genuine speech) and the temporal-continuity
  // hypothesis these fields test: a held musical note/chord is
  // hypothesized to produce ONE long unbroken run of qualifying samples;
  // real speech's own phoneme-rate volatility is hypothesized to produce
  // MANY short ones, even at an identical aggregate qualification rate.
  //
  // The longest unbroken (zero gap tolerance) run of consecutive
  // spectralQualified=true samples this recording -- compare against the
  // existing, gap-TOLERANT maxCandidateSpeechMs to see whether a
  // confirmed streak needed gap-bridging (many short bursts, speech-like)
  // or was one genuinely continuous stretch (music-like).
  longestSpectralQualifiedRunMs: number;
  // How many DISTINCT such runs occurred -- combined with
  // spectralQualifiedSampleCount, gives the average run length.
  spectralQualifiedRunCount: number;
  // Same run-tracking, but for samples passing BOTH gates on the
  // identical sample (the strictest possible per-sample test) instead of
  // spectral alone.
  longestFullyQualifiedRunMs: number;
  fullyQualifiedRunCount: number;
  // VAD start-detection hardening, ROUND 9 (2026-08-23): see this
  // module's own ROUND 9 doc comment for the real production false
  // positive (a single, isolated spectral instant laundered into a full
  // streak via the cross-modal recency window) this answers directly.
  // The highest count of DISTINCT, individually spectrally-qualified
  // samples any single (still-alive) START streak reached this
  // recording -- a recording where minStartSpectralHitCount blocked
  // confirmation shows this staying below the config value even while
  // maxCandidateSpeechMs (streak duration) reached or exceeded
  // minSpeechDurationMs; a genuine confirmation shows it at or above.
  peakStreakSpectralHitCount: number;
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
  postConfirmationSampleCount: number;
  continuationQualifiedSampleCount: number;
  continuationSpectralOnlySampleCount: number;
  continuationAmplitudeOnlySampleCount: number;
  longestPostConfirmationGapMs: number;
  lastWindowedCandidateAt: number | null;
  ambientSpectralRatioEstimate: number;
  peakAmbientSpectralRatioEstimate: number;
  spectralLiftQualifiedSampleCount: number;
  longestSpectralQualifiedRunMs: number;
  spectralQualifiedRunCount: number;
  longestFullyQualifiedRunMs: number;
  fullyQualifiedRunCount: number;
  peakStreakSpectralHitCount: number;
}): VoiceActivityDiagnostics {
  const speechDetectedAtMs =
    params.speechDetectedAt !== null ? Math.max(0, Math.round(params.speechDetectedAt - params.recordingStartedAt)) : null;
  const speechEndedAtMs =
    params.lastSpeechAt !== null ? Math.max(0, Math.round(params.lastSpeechAt - params.recordingStartedAt)) : null;
  // ROUND 6: null (never fabricated) whenever speech was never confirmed
  // at all -- there is no "post-confirmation" period to describe, the
  // same convention speechDurationMs already follows.
  const hadConfirmedSpeech = params.speechDetectedAt !== null;
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
    postConfirmationSampleCount: hadConfirmedSpeech ? params.postConfirmationSampleCount : null,
    continuationQualifiedSampleCount: hadConfirmedSpeech ? params.continuationQualifiedSampleCount : null,
    continuationSpectralOnlySampleCount: hadConfirmedSpeech ? params.continuationSpectralOnlySampleCount : null,
    continuationAmplitudeOnlySampleCount: hadConfirmedSpeech ? params.continuationAmplitudeOnlySampleCount : null,
    longestPostConfirmationGapMs: hadConfirmedSpeech ? params.longestPostConfirmationGapMs : null,
    lastStrongEvidenceAgeAtStopMs:
      params.autoStopReason === "stop_silence" && params.lastWindowedCandidateAt !== null
        ? Math.max(0, Math.round(params.stopDecidedAt - params.lastWindowedCandidateAt))
        : null,
    ambientSpectralRatioEstimate: params.ambientSpectralRatioEstimate,
    peakAmbientSpectralRatioEstimate: params.peakAmbientSpectralRatioEstimate,
    spectralLiftQualifiedSampleCount: params.spectralLiftQualifiedSampleCount,
    longestSpectralQualifiedRunMs: params.longestSpectralQualifiedRunMs,
    spectralQualifiedRunCount: params.spectralQualifiedRunCount,
    longestFullyQualifiedRunMs: params.longestFullyQualifiedRunMs,
    fullyQualifiedRunCount: params.fullyQualifiedRunCount,
    peakStreakSpectralHitCount: params.peakStreakSpectralHitCount,
  };
}
