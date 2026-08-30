"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from "react";

import { HEAD_ZONES, type HeadZone } from "@/lib/technical-visual-map-validators";
import type { NormalizedPoint, TechnicalVisualMapSpatialPayload } from "@/lib/technical-visual-map-spatial-validators";

import { HEAD_ZONE_ABBREVIATIONS, HEAD_ZONE_LABELS } from "./spatial-binding-logic";
import { clamp01, computeContainedImageRect, naturalDimensionsMatchFrozen } from "./spatial-binding-projection";

export interface SpatialBindingOverlayProps {
  imageUrl: string;
  imageAlt: string;
  frozenWidth: number;
  frozenHeight: number;
  payload: TechnicalVisualMapSpatialPayload;
  editable: boolean;
  activeZone: HeadZone | null;
  perimeterDrawMode: boolean;
  onPlaceActiveZone?: (point: NormalizedPoint) => void;
  onDragZone?: (zone: HeadZone, point: NormalizedPoint) => void;
  onAddPerimeterPoint?: (point: NormalizedPoint) => void;
  onDragPerimeterPoint?: (index: number, point: NormalizedPoint) => void;
}

type DragTarget = { kind: "zone"; zone: HeadZone } | { kind: "perimeter"; index: number };

// Technical Visual Map, Stage 5C -- the SVG spatial-authoring overlay.
//
// Architecture (locked): positioned container -> object-contain <img> ->
// SVG sized and positioned to the ACTUAL rendered image rectangle (never
// simply stretched across the outer container -- that would misalign every
// anchor whenever object-contain letterboxes). The SVG's own viewBox is set
// to its own pixel dimensions (i.e. 1 user unit = 1 CSS pixel, a UNIFORM
// scale in x and y), specifically so a fixed-pixel-radius circle renders as
// a true circle regardless of the image's aspect ratio -- a viewBox of
// "0 0 1 1" with non-uniform stretching would render every anchor as an
// ellipse whenever width != height, which a professional would reasonably
// read as broken.
//
// Persisted/exchanged geometry is ALWAYS normalized 0..1 image-space; pixel
// math exists only transiently, inside this component, to render and to
// convert a live pointer event back to a normalized point.
//
// Authoritative denominator: frozenWidth/frozenHeight (the persisted source
// dimensions), never the browser's own naturalWidth/naturalHeight -- the
// latter is read ONLY as a sanity check (requirement #33); a mismatch
// renders a safe error state instead of a potentially misaligned overlay.
export function SpatialBindingOverlay({
  imageUrl,
  imageAlt,
  frozenWidth,
  frozenHeight,
  payload,
  editable,
  activeZone,
  perimeterDrawMode,
  onPlaceActiveZone,
  onDragZone,
  onAddPerimeterPoint,
  onDragPerimeterPoint,
}: SpatialBindingOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [dimensionMismatch, setDimensionMismatch] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rect = computeContainedImageRect(containerSize, { width: frozenWidth, height: frozenHeight });
  const overlayReady = rect.width > 0 && rect.height > 0 && !dimensionMismatch && !imageFailed;

  function pointFromClientCoordinates(clientX: number, clientY: number): NormalizedPoint | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const svgRect = svg.getBoundingClientRect();
    if (svgRect.width <= 0 || svgRect.height <= 0) return null;
    return { x: clamp01((clientX - svgRect.left) / svgRect.width), y: clamp01((clientY - svgRect.top) / svgRect.height) };
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!editable || dragTarget) return;
    const point = pointFromClientCoordinates(event.clientX, event.clientY);
    if (!point) return;
    if (perimeterDrawMode) {
      onAddPerimeterPoint?.(point);
      return;
    }
    if (activeZone) {
      onPlaceActiveZone?.(point);
    }
  }

  function beginDrag(target: DragTarget, event: ReactPointerEvent<SVGElement>) {
    if (!editable) return;
    event.stopPropagation();
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDragTarget(target);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragTarget) return;
    event.preventDefault();
    const point = pointFromClientCoordinates(event.clientX, event.clientY);
    if (!point) return;
    if (dragTarget.kind === "zone") onDragZone?.(dragTarget.zone, point);
    else onDragPerimeterPoint?.(dragTarget.index, point);
  }

  function endDrag() {
    setDragTarget(null);
  }

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    if (!naturalDimensionsMatchFrozen({ width: image.naturalWidth, height: image.naturalHeight }, { width: frozenWidth, height: frozenHeight })) {
      setDimensionMismatch(true);
    }
  }

  const placedZones = HEAD_ZONES.map((zone) => payload.zones.find((entry) => entry.zone === zone)).filter(
    (entry): entry is Extract<TechnicalVisualMapSpatialPayload["zones"][number], { state: "placed" }> =>
      entry !== undefined && entry.state === "placed",
  );

  return (
    <div
      ref={containerRef}
      className="relative h-[380px] w-full overflow-hidden rounded-lg border border-border bg-surface-alt sm:h-[440px]"
      style={{ touchAction: editable && (activeZone || perimeterDrawMode || dragTarget) ? "none" : "auto" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served through an authenticated API route, not a build-time-known asset */}
      <img
        src={imageUrl}
        alt={imageAlt}
        className="h-full w-full object-contain"
        draggable={false}
        onLoad={handleImageLoad}
        onError={() => setImageFailed(true)}
      />

      {imageFailed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-alt/95 p-4 text-center text-sm text-muted">
          This photo is no longer available.
        </div>
      ) : dimensionMismatch ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-alt/95 p-4 text-center text-sm text-muted">
          This photo&apos;s current dimensions don&apos;t match the ones this spatial map was created from, so it can&apos;t be
          safely aligned. Please refresh, or create a new spatial map from this photo.
        </div>
      ) : null}

      {overlayReady ? (
        <svg
          ref={svgRef}
          className="absolute"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          viewBox={`0 0 ${rect.width} ${rect.height}`}
          onPointerDown={handleBackgroundPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="img"
          aria-label="Spatial mapping overlay"
        >
          {payload.perimeter.state === "placed" ? (
            <>
              <polyline
                points={payload.perimeter.points.map((point) => `${point.x * rect.width},${point.y * rect.height}`).join(" ")}
                fill="none"
                stroke="var(--tvm-perimeter-color, #f0b429)"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              {payload.perimeter.points.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x * rect.width}
                  cy={point.y * rect.height}
                  r={7}
                  fill="var(--tvm-perimeter-color, #f0b429)"
                  stroke="white"
                  strokeWidth={1.5}
                  style={{ cursor: editable ? "grab" : "default", touchAction: "none" }}
                  onPointerDown={(event) => beginDrag({ kind: "perimeter", index }, event)}
                  role="button"
                  aria-label={`Perimeter point ${index + 1}${editable ? ", draggable" : ""}`}
                  tabIndex={editable ? 0 : -1}
                />
              ))}
            </>
          ) : null}

          {placedZones.map((entry) => (
            <g
              key={entry.zone}
              transform={`translate(${entry.x * rect.width}, ${entry.y * rect.height})`}
              style={{ cursor: editable ? "grab" : "default", touchAction: "none" }}
              onPointerDown={(event) => beginDrag({ kind: "zone", zone: entry.zone }, event)}
              role="button"
              aria-label={`${HEAD_ZONE_LABELS[entry.zone]} anchor${editable ? ", draggable" : ""}`}
              tabIndex={editable ? 0 : -1}
            >
              {/* A larger, invisible hit target keeps dragging finger-friendly
                  on mobile without making the stored coordinate or the visible
                  marker itself coarse (requirement #14). */}
              <circle r={18} fill="transparent" />
              <circle r={9} fill="var(--tvm-accent-color, #0f9c93)" stroke="white" strokeWidth={2} />
              <text
                y={-16}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill="var(--tvm-accent-color, #0f9c93)"
                stroke="white"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {HEAD_ZONE_ABBREVIATIONS[entry.zone]}
              </text>
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}
