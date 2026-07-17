import sharp from 'sharp';

export interface NormalizedImageResult {
  buffer: Buffer;
  mimeType: string;
  orientation: number;
  width: number;
  height: number;
}

export async function normalizeImage(buffer: Buffer, mimeType: string): Promise<NormalizedImageResult> {
  let img = sharp(buffer);
  const metadata = await img.metadata();
  const orientation = metadata.orientation || 1;

  let rotationDegrees = 0;
  switch (orientation) {
    case 2:
      img = img.flop();
      break;
    case 3:
      rotationDegrees = 180;
      break;
    case 4:
      img = img.flip();
      break;
    case 5:
      rotationDegrees = 90;
      img = img.flop();
      break;
    case 6:
      rotationDegrees = 90;
      break;
    case 7:
      rotationDegrees = 270;
      img = img.flop();
      break;
    case 8:
      rotationDegrees = 270;
      break;
  }

  if (rotationDegrees > 0) {
    img = img.rotate(rotationDegrees);
  }

  const normalizedBuffer = await img.withMetadata({ density: 72 }).toBuffer();
  const newMetadata = await sharp(normalizedBuffer).metadata();

  return {
    buffer: normalizedBuffer,
    mimeType,
    orientation: 1,
    width: newMetadata.width || 0,
    height: newMetadata.height || 0,
  };
}

export async function stripExif(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer).withMetadata({ density: 72 }).toBuffer();
  } catch {
    return buffer;
  }
}

export async function processImageForStorage(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; orientation: number; exifStripped: boolean }> {
  const noExifBuffer = await stripExif(buffer);
  const normalized = await normalizeImage(noExifBuffer, mimeType);

  return {
    buffer: normalized.buffer,
    orientation: normalized.orientation,
    exifStripped: true,
  };
}
