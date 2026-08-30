"use client";

import { useEffect, useState } from "react";

import { Alert, LoadingState, Select } from "@/components/ui";
import { VIEW_LABELS } from "@/lib/technical-visual-map-spatial-validators";

import { VIEW_LABEL_DISPLAY } from "./spatial-binding-logic";

export interface EligibleSpatialSourceImage {
  id: string;
  fileName: string;
  width: number;
  height: number;
  uploadedAt: string;
  imageUrl: string;
}

export interface SpatialBindingImageSelectorProps {
  clientId: string;
  selectedImageId: string | null;
  selectedViewLabel: string | null;
  onSelectImage: (imageId: string | null) => void;
  onSelectViewLabel: (viewLabel: string | null) => void;
}

// Technical Visual Map, Stage 5C -- lets the professional pick the exact
// eligible source image (one whose normalized dimensions are known -- see
// eligible-spatial-source-images/route.ts) and a professional-declared view.
// The browser's own selection is never authoritative by itself: Stage 5B's
// createDraftSpatialBinding independently re-verifies ownership and
// dimensions server-side regardless of what this list shows.
export function SpatialBindingImageSelector({
  clientId,
  selectedImageId,
  selectedViewLabel,
  onSelectImage,
  onSelectViewLabel,
}: SpatialBindingImageSelectorProps) {
  const [images, setImages] = useState<EligibleSpatialSourceImage[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Reset for THIS clientId inside the async callback, not synchronously
      // in the effect body -- matches use-spatial-binding.ts's own fix for
      // the identical react-hooks/set-state-in-effect pattern.
      setImages(null);
      setLoadFailed(false);
      try {
        const response = await fetch(`/api/v1/clients/${clientId}/eligible-spatial-source-images`);
        if (cancelled) return;
        if (!response.ok) {
          setLoadFailed(true);
          return;
        }
        const body = (await response.json()) as { images: EligibleSpatialSourceImage[] };
        if (!cancelled) setImages(body.images);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loadFailed) {
    return <Alert variant="error">Couldn&apos;t load this client&apos;s photos. Please try refreshing the page.</Alert>;
  }

  if (images === null) {
    return <LoadingState label="Loading eligible photos..." />;
  }

  if (images.length === 0) {
    return (
      <Alert variant="info">
        No eligible photos yet. A photo needs known dimensions before it can be used for spatial mapping -- upload a new
        photo to get started.
      </Alert>
    );
  }

  const selected = images.find((image) => image.id === selectedImageId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Source photo"
          value={selectedImageId ?? ""}
          onChange={(event) => onSelectImage(event.target.value || null)}
        >
          <option value="">Select a photo</option>
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.fileName} · {new Date(image.uploadedAt).toLocaleDateString()}
            </option>
          ))}
        </Select>

        <Select
          label="View"
          value={selectedViewLabel ?? ""}
          onChange={(event) => onSelectViewLabel(event.target.value || null)}
        >
          <option value="">Select a view</option>
          {VIEW_LABELS.map((label) => (
            <option key={label} value={label}>
              {VIEW_LABEL_DISPLAY[label]}
            </option>
          ))}
        </Select>
      </div>

      {selected ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-alt p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- served through an authenticated API route */}
          <img src={selected.imageUrl} alt={`Preview of ${selected.fileName}`} className="h-16 w-16 rounded-lg object-cover" />
          <p className="text-xs text-muted">
            Mapping <span className="font-medium text-foreground">{selected.fileName}</span> ({selected.width}×{selected.height})
          </p>
        </div>
      ) : null}
    </div>
  );
}
