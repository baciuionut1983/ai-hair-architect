import { describe, expect, it } from "vitest";

import {
  clamp01,
  computeContainedImageRect,
  containerPixelsToNormalizedClamped,
  isPointWithinContainedImageRect,
  naturalDimensionsMatchFrozen,
  normalizedToContainerPixels,
} from "./spatial-binding-projection";

describe("computeContainedImageRect", () => {
  it("7. horizontal letterbox: a wide container with a tall(er) image letterboxes left/right", () => {
    // Container 1000x500, image is portrait 1000x2000 (aspect 0.5) -> scale
    // limited by height: 500/2000 = 0.25 -> renders 250x500, centered.
    const rect = computeContainedImageRect({ width: 1000, height: 500 }, { width: 1000, height: 2000 });
    expect(rect).toEqual({ left: 375, top: 0, width: 250, height: 500 });
  });

  it("8. vertical letterbox: a tall container with a wide(r) image letterboxes top/bottom", () => {
    // Container 500x1000, image is landscape 2000x1000 (aspect 2) -> scale
    // limited by width: 500/2000 = 0.25 -> renders 500x250, centered vertically.
    const rect = computeContainedImageRect({ width: 500, height: 1000 }, { width: 2000, height: 1000 });
    expect(rect).toEqual({ left: 0, top: 375, width: 500, height: 250 });
  });

  it("an image matching the container's own aspect ratio fills it exactly, no letterbox", () => {
    const rect = computeContainedImageRect({ width: 800, height: 600 }, { width: 400, height: 300 });
    expect(rect).toEqual({ left: 0, top: 0, width: 800, height: 600 });
  });

  it("returns a zero-size rect for non-positive/invalid input rather than NaN/Infinity", () => {
    expect(computeContainedImageRect({ width: 0, height: 500 }, { width: 100, height: 100 })).toEqual({ left: 0, top: 0, width: 0, height: 0 });
    expect(computeContainedImageRect({ width: 500, height: 500 }, { width: 0, height: 0 })).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
});

describe("normalizedToContainerPixels / containerPixelsToNormalizedClamped -- round trip", () => {
  const rect = computeContainedImageRect({ width: 1000, height: 500 }, { width: 1000, height: 2000 }); // letterboxed left/right

  it("5. normalized -> display projection lands inside the rendered image rect", () => {
    const pixel = normalizedToContainerPixels({ x: 0.5, y: 0.5 }, rect);
    expect(pixel).toEqual({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  });

  it("6. display -> normalized inverse conversion recovers the original point", () => {
    const original = { x: 0.25, y: 0.75 };
    const pixel = normalizedToContainerPixels(original, rect);
    const recovered = containerPixelsToNormalizedClamped(pixel, rect);
    expect(recovered.x).toBeCloseTo(original.x, 10);
    expect(recovered.y).toBeCloseTo(original.y, 10);
  });

  it("9. clamps out-of-range pixel positions to [0,1] instead of producing values outside it", () => {
    const wayOutside = containerPixelsToNormalizedClamped({ x: -9999, y: 9999 }, rect);
    expect(wayOutside.x).toBe(0);
    expect(wayOutside.y).toBe(1);
  });

  it("10. the SAME normalized point projects correctly under two different container sizes -- geometry itself never changes across a resize", () => {
    const point = { x: 0.3, y: 0.6 };
    const rectA = computeContainedImageRect({ width: 400, height: 800 }, { width: 1000, height: 2000 });
    const rectB = computeContainedImageRect({ width: 1200, height: 800 }, { width: 1000, height: 2000 }); // wider container after resize

    const pixelA = normalizedToContainerPixels(point, rectA);
    const pixelB = normalizedToContainerPixels(point, rectB);

    // Different pixel positions (the display changed)...
    expect(pixelA).not.toEqual(pixelB);
    // ...but converting each back recovers the exact same stored point (the
    // geometry itself was never touched by the resize).
    expect(containerPixelsToNormalizedClamped(pixelA, rectA).x).toBeCloseTo(point.x, 10);
    expect(containerPixelsToNormalizedClamped(pixelB, rectB).x).toBeCloseTo(point.x, 10);
  });
});

describe("clamp01", () => {
  it("clamps below 0, above 1, and non-finite values", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(1);
    expect(clamp01(-Infinity)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
  });
});

describe("isPointWithinContainedImageRect", () => {
  const rect = computeContainedImageRect({ width: 1000, height: 500 }, { width: 1000, height: 2000 }); // letterboxed left/right

  it("a click inside the rendered image rect is within it", () => {
    expect(isPointWithinContainedImageRect({ x: 500, y: 250 }, rect)).toBe(true);
  });

  it("a click in the letterbox padding is NOT within the rendered image rect", () => {
    expect(isPointWithinContainedImageRect({ x: 10, y: 250 }, rect)).toBe(false); // left letterbox bar
  });
});

describe("naturalDimensionsMatchFrozen", () => {
  it("matches when the browser-loaded natural size equals the frozen source size", () => {
    expect(naturalDimensionsMatchFrozen({ width: 1080, height: 1440 }, { width: 1080, height: 1440 })).toBe(true);
  });

  it("does not match when they differ, signalling a safe mapping-error state should be used", () => {
    expect(naturalDimensionsMatchFrozen({ width: 1080, height: 1440 }, { width: 1200, height: 1600 })).toBe(false);
  });
});
