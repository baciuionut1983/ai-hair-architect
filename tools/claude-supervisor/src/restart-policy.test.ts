import { describe, expect, it } from "vitest";

import { MAX_CONSECUTIVE_RESTARTS, computeBackoffMs, decideRestart, detectNoProgressLoop } from "./restart-policy.js";

describe("decideRestart", () => {
  it("allows a restart when the current count is below the max", () => {
    const decision = decideRestart(0);
    expect(decision.action).toBe("RESTART");
    if (decision.action === "RESTART") {
      expect(decision.attemptNumber).toBe(1);
      expect(decision.backoffMs).toBeGreaterThan(0);
    }
  });

  it("allows exactly up to MAX_CONSECUTIVE_RESTARTS restarts, never more", () => {
    for (let count = 0; count < MAX_CONSECUTIVE_RESTARTS; count += 1) {
      expect(decideRestart(count).action).toBe("RESTART");
    }
    expect(decideRestart(MAX_CONSECUTIVE_RESTARTS).action).toBe("ESCALATE");
  });

  it("escalates once the count has already reached the max", () => {
    const decision = decideRestart(MAX_CONSECUTIVE_RESTARTS);
    expect(decision.action).toBe("ESCALATE");
    if (decision.action === "ESCALATE") {
      expect(decision.reason).toContain(String(MAX_CONSECUTIVE_RESTARTS));
    }
  });

  it("never de-escalates for a count past the max either", () => {
    expect(decideRestart(MAX_CONSECUTIVE_RESTARTS + 5).action).toBe("ESCALATE");
  });
});

describe("computeBackoffMs", () => {
  it("returns 0 for attempt number 0 or negative (no restart happening)", () => {
    expect(computeBackoffMs(0)).toBe(0);
    expect(computeBackoffMs(-1)).toBe(0);
  });

  it("grows with each attempt number, exponentially, within the cap", () => {
    const first = computeBackoffMs(1);
    const second = computeBackoffMs(2);
    const third = computeBackoffMs(3);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("never exceeds the cap even for a large attempt number", () => {
    expect(computeBackoffMs(10)).toBeLessThanOrEqual(60_000);
  });
});

describe("detectNoProgressLoop", () => {
  it("returns false when there is not yet enough history", () => {
    expect(detectNoProgressLoop(["a"])).toBe(false);
  });

  it("returns false when recent diff summaries genuinely differ (real progress)", () => {
    expect(detectNoProgressLoop(["1 file changed", "2 files changed", "3 files changed"])).toBe(false);
  });

  it("returns true when the most recent restarts all produced the identical diff summary", () => {
    expect(detectNoProgressLoop(["1 file changed, 2 insertions(+)", "1 file changed, 2 insertions(+)", "1 file changed, 2 insertions(+)"])).toBe(
      true,
    );
  });

  it("returns false when the identical-looking run is null (no diff at all yet) rather than a real repeated summary", () => {
    expect(detectNoProgressLoop([null, null, null])).toBe(false);
  });

  it("only looks at the MOST RECENT window, ignoring older, genuinely different history", () => {
    expect(detectNoProgressLoop(["0 files changed", "same", "same", "same"])).toBe(true);
  });
});
