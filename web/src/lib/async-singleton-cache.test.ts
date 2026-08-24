import { describe, expect, it, vi } from "vitest";

import { createAsyncSingletonCache } from "./async-singleton-cache";

// A controllable clock so durationMs assertions are exact, not
// timing-flaky.
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createAsyncSingletonCache", () => {
  // Required test 4: two preload calls simultaneously -> a single real load.
  it("two concurrent start() calls while an attempt is pending share the SAME promise -- the factory runs exactly once", async () => {
    let resolveFactory!: (value: string) => void;
    const factory = vi.fn(() => new Promise<string>((resolve) => (resolveFactory = resolve)));
    const cache = createAsyncSingletonCache(factory);

    const first = cache.start();
    const second = cache.start();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    resolveFactory("ready");
    await expect(first).resolves.toBe("ready");
  });

  // Required test 3: preload success -> a later start() reuses the same
  // (already-resolved) result, never calling the factory again.
  it("after a successful resolution, a later start() returns the cached result without calling the factory again", async () => {
    const factory = vi.fn(async () => "session-1");
    const cache = createAsyncSingletonCache(factory);

    await cache.start();
    const second = await cache.start();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe("session-1");
    expect(cache.isReady()).toBe(true);
  });

  // Required test 6 (the cache-level half): preload failure does not
  // permanently disable the cache -- a later start() gets a genuine
  // fresh retry.
  it("after a failed attempt, a later start() retries the factory fresh (not permanently stuck on one failure)", async () => {
    const factory = vi.fn().mockRejectedValueOnce(new Error("network blip")).mockResolvedValueOnce("session-2");
    const cache = createAsyncSingletonCache(factory);

    await expect(cache.start()).rejects.toThrow("network blip");
    // Give the internal .catch() a microtask to run and reset the cache.
    await Promise.resolve();
    await Promise.resolve();

    const second = await cache.start();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(second).toBe("session-2");
    expect(cache.isReady()).toBe(true);
  });

  // Required test 5: a start() call that arrives WHILE an earlier attempt
  // is still pending (e.g. a recording starting while a background
  // preload is in flight) reuses that exact same in-flight promise --
  // proven here, then followed through to the failure/retry boundary, to
  // show the two behaviors compose correctly: dedup while pending, retry
  // only after a genuine, definitive failure.
  it("a start() call while pending reuses the in-flight promise; only AFTER that attempt definitively fails does a later start() begin a genuinely new one", async () => {
    let rejectFirst!: (error: Error) => void;
    const firstAttempt = new Promise<string>((_, reject) => (rejectFirst = reject));
    const factory = vi.fn().mockReturnValueOnce(firstAttempt).mockResolvedValueOnce("session-3");
    const cache = createAsyncSingletonCache(factory);

    const first = cache.start();
    // A second caller arriving while the first is still pending (e.g. a
    // recording's own mic press racing a background preload) gets the
    // SAME promise -- no second load starts.
    expect(cache.start()).toBe(first);

    rejectFirst(new Error("first attempt failed"));
    await expect(first).rejects.toThrow("first attempt failed");
    await Promise.resolve();
    await Promise.resolve();

    const second = cache.start();
    await expect(second).resolves.toBe("session-3");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("isReady() is false before resolution and true only after a successful resolution", async () => {
    let resolveFactory!: (value: string) => void;
    const cache = createAsyncSingletonCache(() => new Promise<string>((resolve) => (resolveFactory = resolve)));

    expect(cache.isReady()).toBe(false);
    const pending = cache.start();
    expect(cache.isReady()).toBe(false);

    resolveFactory("ready");
    await pending;
    expect(cache.isReady()).toBe(true);
  });

  it("getTelemetry() reports attempted/completed/durationMs correctly across the lifecycle", async () => {
    const clock = fakeClock();
    let resolveFactory!: (value: string) => void;
    const cache = createAsyncSingletonCache(() => new Promise<string>((resolve) => (resolveFactory = resolve)), clock.now);

    expect(cache.getTelemetry()).toEqual({ attempted: false, completed: false, durationMs: null });

    cache.markAttempted();
    const pending = cache.start();
    expect(cache.getTelemetry()).toEqual({ attempted: true, completed: false, durationMs: null });

    clock.advance(842);
    resolveFactory("ready");
    await pending;

    expect(cache.getTelemetry()).toEqual({ attempted: true, completed: true, durationMs: 842 });
  });

  // Required test 6 (the "never an unhandled rejection" half): a caller
  // that never awaits or attaches its own .catch() to start()'s return
  // value must not crash/produce an unhandled rejection -- the cache's
  // own internal .catch() (see this module's own doc comment) already
  // handles it at the source.
  it("a failing attempt whose returned promise nobody awaits does not produce an unhandled rejection", async () => {
    const cache = createAsyncSingletonCache(async () => {
      throw new Error("boom");
    });

    // Deliberately fire-and-forget, exactly like use-voice-recording.ts's
    // own mount-effect preload trigger.
    cache.start();

    // If the internal .catch() were missing, this would surface as an
    // unhandled rejection in the test process -- reaching this line at
    // all (after yielding several microtasks) is the proof.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.isReady()).toBe(false);
  });
});
