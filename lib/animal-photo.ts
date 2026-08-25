/** Shared rules for animal portraits, kept out of the route so they're testable. */

export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Ceiling on the stored base64 string. The browser downscales to ~1200px JPEG
 * before uploading, which lands well under 300 KB — this is a backstop against
 * a hand-rolled request, not the normal path.
 *
 * Held below what the database will actually take. D1 refuses a value over
 * roughly 2.1 MB with SQLITE_TOOBIG, so the previous 2,800,000 accepted photos
 * the app then failed to store: the keeper got "Unable to save the photo" and a
 * 500, having passed every check the app performs. Refusing early gives them
 * the honest answer instead.
 */
export const MAX_PHOTO_BASE64_LENGTH = 2_000_000;

export type ParsedPhoto = { mime: string; base64: string; byteSize: number };

/**
 * Pull the mime type and payload out of a `data:` URL, rejecting anything that
 * isn't one of the image types we're willing to serve back.
 */
export function parsePhotoDataUrl(input: unknown): { photo: ParsedPhoto } | { error: string } {
  if (typeof input !== "string" || !input) return { error: "Choose a photo to upload." };
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(input.trim());
  if (!match) return { error: "That file didn't look like an image." };

  const mime = match[1].toLowerCase();
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(mime)) {
    return { error: "Photos need to be a JPEG, PNG, or WebP." };
  }

  const base64 = match[2];
  if (base64.length > MAX_PHOTO_BASE64_LENGTH) return { error: "That photo is too large — try a smaller one." };

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteSize = Math.floor((base64.length * 3) / 4) - padding;
  if (byteSize <= 0) return { error: "That photo came through empty." };

  return { photo: { mime, base64, byteSize } };
}

/** Decode base64 to bytes for the response body. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
