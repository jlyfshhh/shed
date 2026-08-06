"use client";

import { useRef, useState } from "react";

/** Longest edge we keep. Big enough for a retina card, small enough to store inline. */
const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.82;

/**
 * Downscale a picked file to a JPEG data URL in the browser.
 *
 * Phone photos are 3–8 MB; shrinking here keeps the request small and means the
 * database never holds a full-resolution original. `createImageBitmap` applies
 * the EXIF rotation, so portraits shot sideways come out upright.
 */
export async function fileToPortrait(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser wouldn't let us resize the photo.");
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close?.();
  }
}

export function animalPhotoUrl(animalId: string, photoUpdatedAt: string | null | undefined): string | null {
  if (!photoUpdatedAt) return null;
  // The timestamp doubles as a cache key, so a new photo shows up immediately.
  return `/api/animals/${encodeURIComponent(animalId)}/photo?v=${encodeURIComponent(photoUpdatedAt)}`;
}

/**
 * Add / replace / remove the portrait, shown under the animal's picture on its
 * profile. Any signed-in keeper can use it — they're the ones holding the animal.
 */
export function AnimalPhotoControls({
  animalId,
  hasPhoto,
  onChanged,
}: {
  animalId: string;
  hasPhoto: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToPortrait(file).catch(() => {
        throw new Error("Couldn’t read that image. If it came from an iPhone, try saving it as a JPEG first.");
      });
      const response = await fetch(`/api/animals/${encodeURIComponent(animalId)}/photo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t save the photo.");
      await onChanged();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Couldn’t save the photo.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/animals/${encodeURIComponent(animalId)}/photo`, { method: "DELETE" });
      if (!response.ok) throw new Error("Couldn’t remove the photo.");
      await onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Couldn’t remove the photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="photo-controls">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <button disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Working…" : hasPhoto ? "Replace photo" : "＋ Add photo"}
      </button>
      {hasPhoto && !busy && <button className="photo-remove" onClick={() => void remove()}>Remove</button>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
