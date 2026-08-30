// Technical Visual Map, Stage 5C -- pure image-space <-> display-space
// projection math. No React, no DOM reads beyond the plain numeric sizes a
// caller already measured -- unit-testable with zero rendering environment.
//
// IMAGE-SPACE: normalized 0..1 coordinates relative to the canonical stored
// image's own pixel grid. This is the ONLY thing ever persisted.
// DISPLAY-SPACE: wherever the browser currently paints those pixels --
// changes on every resize/orientation change and, critically, under
// object-fit: contain, is NOT the same rectangle as the container whenever
// the container's aspect ratio differs from the image's own (letterboxing).
// The persisted geometry must never depend on, or be computed from, the
// current CSS pixel dimensions of anything.

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface ContainerSize {
  width: number;
  height: number;
}

export interface NaturalImageSize {
  width: number;
  height: number;
}

// The actual on-screen rectangle the image occupies inside its container
// under object-fit: contain -- the letterboxed INNER rectangle, never the
// full container. Coordinates are relative to the container's own top-left.
export interface ContainedImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0; // also catches -Infinity
  if (value > 1) return 1; // also catches +Infinity
  return value;
}

// object-contain letterbox math: scale = min(boxW/imgW, boxH/imgH), centered.
// Returns a zero-size rect for any non-positive/invalid input rather than
// dividing by zero or producing NaN/Infinity.
export function computeContainedImageRect(container: ContainerSize, natural: NaturalImageSize): ContainedImageRect {
  if (container.width <= 0 || container.height <= 0 || natural.width <= 0 || natural.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const scale = Math.min(container.width / natural.width, container.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  const left = (container.width - width) / 2;
  const top = (container.height - height) / 2;
  return { left, top, width, height };
}

// Image-space (0..1) -> display-space pixels, relative to the CONTAINER's
// own top-left -- i.e. exactly where to position an element inside it.
export function normalizedToContainerPixels(point: NormalizedPoint, rect: ContainedImageRect): PixelPoint {
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height };
}

// The inverse, used while actively dragging an already-placed element:
// always returns a value, clamped to [0,1] -- geometry can never drift
// outside the image regardless of how far the pointer strays (e.g. into the
// letterbox bars) during a fast drag gesture.
export function containerPixelsToNormalizedClamped(point: PixelPoint, rect: ContainedImageRect): NormalizedPoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return { x: clamp01((point.x - rect.left) / rect.width), y: clamp01((point.y - rect.top) / rect.height) };
}

// Used specifically for a NEW placement click/tap: a click that lands
// outside the actual rendered image (in the letterbox padding) is not "on
// the photo" and must not silently register at the nearest edge -- callers
// should check this before accepting a placement, then use
// containerPixelsToNormalizedClamped (or the same math) to convert the
// confirmed-inside point.
export function isPointWithinContainedImageRect(point: PixelPoint, rect: ContainedImageRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}

// Stage 5C requirement #33: browser-loaded natural dimensions are never
// authoritative -- they are a sanity check ONLY. A mismatch against the
// frozen/persisted source dimensions means the live asset may no longer be
// the same bytes the binding's geometry was authored against; callers must
// prefer a safe "can't verify alignment" error state over silently
// rendering a potentially misaligned overlay.
export function naturalDimensionsMatchFrozen(natural: NaturalImageSize, frozen: NaturalImageSize): boolean {
  return natural.width === frozen.width && natural.height === frozen.height;
}
