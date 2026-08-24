// VAD Round 13 (2026-08-24), Phase B.2: a small, fully generic, pure
// primitive for "run this async factory AT MOST ONCE concurrently, cache
// a successful result forever, but allow a genuine retry after a
// definitive failure" -- extracted specifically so this MECHANISM (not
// any particular use of it) is directly unit-testable with a fake
// factory, independent of whatever real, browser-only async work a
// caller (silero-vad-shadow-runtime.ts's own model/session preload) plugs
// into it. Zero dependency on Web Audio, onnxruntime-web, or anything
// browser-specific.
//
// Concurrency semantics, precisely:
//   - Two calls to start() while an attempt is still pending share the
//     SAME promise -- the factory runs exactly once, not twice, no matter
//     how many times start() is called in that window.
//   - Once an attempt SUCCEEDS, the resolved promise is kept forever --
//     every future start() call returns that SAME already-resolved
//     promise immediately, and the factory is never called again.
//   - Once an attempt FAILS, the cache resets (only if that failed
//     attempt is still the current one -- a stale rejection from an
//     attempt that was already superseded by a newer one must never
//     clobber it) -- the NEXT start() call genuinely retries the factory
//     from scratch, rather than being permanently stuck on one transient
//     failure.
//   - The internal .catch() is attached on the singleton's OWN promise,
//     not on whatever a given caller does with the value start() returns
//     -- this guarantees the promise is always "handled" at the source,
//     so a caller that never awaits/catches its own copy of the returned
//     promise (a fire-and-forget preload trigger, for instance) can never
//     produce an unhandled rejection.

export interface AsyncSingletonCache<T> {
  start(): Promise<T>;
  // True once the factory has EVER resolved successfully -- stays true
  // forever afterward, even if a LATER, separate concern (not this cache)
  // considers the resolved value stale; this cache itself never expires
  // a success.
  isReady(): boolean;
  // Marks that an explicit (as opposed to implicit/first-use) request to
  // start this attempt happened -- purely descriptive bookkeeping for
  // getTelemetry() below, never affects start()'s own dedup/retry
  // behavior.
  markAttempted(): void;
  getTelemetry(): { attempted: boolean; completed: boolean; durationMs: number | null };
}

export function createAsyncSingletonCache<T>(factory: () => Promise<T>, now: () => number = () => performance.now()): AsyncSingletonCache<T> {
  let current: Promise<T> | null = null;
  let readyAt: number | null = null;
  let attempted = false;
  let startedAt: number | null = null;
  let durationMs: number | null = null;

  function start(): Promise<T> {
    if (current) return current;
    startedAt = now();
    const attempt = factory();
    current = attempt;
    attempt
      .then(() => {
        readyAt = now();
        durationMs = readyAt - (startedAt ?? readyAt);
      })
      .catch(() => {
        durationMs = now() - (startedAt ?? now());
        if (current === attempt) {
          current = null;
        }
      });
    return attempt;
  }

  return {
    start,
    isReady: () => readyAt !== null,
    markAttempted: () => {
      attempted = true;
    },
    getTelemetry: () => ({ attempted, completed: readyAt !== null, durationMs }),
  };
}
