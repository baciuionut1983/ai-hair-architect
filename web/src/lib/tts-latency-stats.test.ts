import { describe, expect, it } from "vitest";

import { computeLatencyStats, computeSuccessRate } from "./tts-latency-stats";

describe("computeLatencyStats", () => {
  it("computes the standard median for an odd sample count (middle value)", () => {
    const stats = computeLatencyStats([5, 1, 3]);
    expect(stats.median).toBe(3);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(stats.count).toBe(3);
  });

  it("computes the standard median for an even sample count (average of the two middle values)", () => {
    const stats = computeLatencyStats([40, 10, 30, 20]);
    expect(stats.median).toBe(25); // (20 + 30) / 2
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(40);
    expect(stats.count).toBe(4);
  });

  it("returns p95 as null below 10 samples, never a fabricated value", () => {
    const nineSamples = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const stats = computeLatencyStats(nineSamples);
    expect(stats.p95).toBeNull();
    expect(stats.median).toBe(5);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(9);
    expect(stats.count).toBe(9);
  });

  it("computes p95 via nearest-rank (ceil(0.95*n)-1) at exactly 10 samples", () => {
    // n = 10 -> ceil(0.95 * 10) - 1 = ceil(9.5) - 1 = 10 - 1 = index 9
    // (0-based) -> the largest value, by hand computation.
    const tenSamples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const stats = computeLatencyStats(tenSamples);
    expect(stats.p95).toBe(1000);
    expect(stats.median).toBe(550); // (500 + 600) / 2
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(1000);
    expect(stats.count).toBe(10);
  });

  it("computes p95 correctly above 10 samples, against a hand-computed expected value (not just 'some number')", () => {
    // 20 values: 10, 20, ..., 200, deliberately shuffled to also prove
    // this sorts before computing rather than trusting input order.
    const shuffled = [120, 10, 200, 90, 40, 170, 60, 150, 30, 180, 70, 110, 20, 190, 80, 160, 50, 130, 100, 140];
    const stats = computeLatencyStats(shuffled);
    // n = 20 -> ceil(0.95 * 20) - 1 = ceil(19) - 1 = 19 - 1 = index 18
    // (0-based) -> the 19th ascending value = 190 (NOT the max, 200 --
    // proving this is a real nearest-rank computation, not an accidental
    // max()).
    expect(stats.p95).toBe(190);
    expect(stats.median).toBe(105); // (100 + 110) / 2, the 10th/11th values
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(200);
    expect(stats.count).toBe(20);
  });

  it("throws a real Error on an empty array, never fabricated zeros", () => {
    expect(() => computeLatencyStats([])).toThrow();
    expect(() => computeLatencyStats([])).toThrow(Error);
  });
});

describe("computeSuccessRate", () => {
  it("returns 0 when every outcome failed", () => {
    expect(computeSuccessRate(["failure", "failure", "failure"])).toBe(0);
  });

  it("returns 0.5 for an even split", () => {
    expect(computeSuccessRate(["success", "failure"])).toBe(0.5);
  });

  it("returns 1 when every outcome succeeded", () => {
    expect(computeSuccessRate(["success", "success"])).toBe(1);
  });

  it("returns the correct fraction for a mixed case", () => {
    // 3 successes out of 4 = 0.75
    expect(computeSuccessRate(["success", "failure", "success", "success"])).toBe(0.75);
  });

  it("throws a real Error on an empty array, never a fabricated rate", () => {
    expect(() => computeSuccessRate([])).toThrow();
    expect(() => computeSuccessRate([])).toThrow(Error);
  });
});
