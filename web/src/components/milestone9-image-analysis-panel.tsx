'use client';

export function ImageUploadPanel() {
  return (
    <div className="space-y-4 p-4">
      <div>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={false}
          className="block w-full"
        />
        <p className="text-sm text-gray-600 mt-1">
          Max 4 images, 8MB each, 24MB total. JPEG/PNG/WebP only.
        </p>
      </div>

      <div className="space-y-2" />
    </div>
  );
}
