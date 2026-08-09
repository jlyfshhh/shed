/**
 * One validator for every attachment Shed stores, whether it arrived from a
 * direct upload or from a restored backup.
 *
 * Restore used to take the MIME type straight out of the JSON and store it, and
 * both serving routes hand that stored value back as the Content-Type. So a
 * bundle could claim `text/html`, and Shed would serve it inline, from Shed's
 * own origin, with Shed's cookies available to it. The declared type is now
 * treated as a claim and checked against the bytes.
 */

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const DOCUMENT_MIME_TYPES = ["application/pdf"] as const;

export type AttachmentKind = "image" | "document";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

type Signature = { mime: string; matches: (bytes: Uint8Array) => boolean };

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0) =>
  bytes.length >= offset + prefix.length && prefix.every((byte, index) => bytes[offset + index] === byte);

// Detection is by content, never by extension or by what the caller said.
const SIGNATURES: Signature[] = [
  { mime: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: "image/png", matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  {
    mime: "image/webp",
    // "RIFF" .... "WEBP"
    matches: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  },
  { mime: "application/pdf", matches: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
];

export type AttachmentCheck =
  | { ok: true; mime: string; byteSize: number }
  | { ok: false; error: string };

/**
 * Decide whether these bytes may be stored and, if so, under which type.
 *
 * The returned mime is the one detected from the bytes — callers must store
 * that rather than whatever was declared, so a mismatch cannot survive.
 */
export function checkAttachment(
  bytes: Uint8Array,
  kind: AttachmentKind,
  declaredMime?: string | null,
): AttachmentCheck {
  const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (!bytes.byteLength) return { ok: false, error: "The attachment is empty." };
  if (bytes.byteLength > limit) {
    return { ok: false, error: `The attachment is larger than ${Math.floor(limit / (1024 * 1024))} MB.` };
  }

  const detected = SIGNATURES.find((signature) => signature.matches(bytes));
  if (!detected) {
    // SVG, HTML, and XML all land here: none of them have a binary signature,
    // and all of them can carry script. Saying so plainly beats "unsupported".
    return { ok: false, error: "That file is not a JPEG, PNG, WebP, or PDF. Script-capable formats such as SVG and HTML are not accepted." };
  }

  const allowed: readonly string[] = kind === "image" ? IMAGE_MIME_TYPES : [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES];
  if (!allowed.includes(detected.mime)) {
    return { ok: false, error: `A ${detected.mime} file cannot be used here.` };
  }

  // A declared type that disagrees with the bytes is a red flag, not a detail
  // to paper over.
  if (declaredMime) {
    const claimed = declaredMime.split(";")[0]!.trim().toLowerCase();
    if (claimed && claimed !== detected.mime) {
      return { ok: false, error: `The file says it is ${claimed} but its contents are ${detected.mime}.` };
    }
  }

  return { ok: true, mime: detected.mime, byteSize: bytes.byteLength };
}

/** Headers every attachment response needs, whatever the route. */
export function attachmentHeaders(mime: string, options: { filename?: string; inline?: boolean } = {}): Record<string, string> {
  const safeName = (options.filename ?? "attachment").replace(/[^a-zA-Z0-9._ -]/g, "_");
  const disposition = options.inline ? "inline" : "attachment";
  return {
    "Content-Type": mime,
    // Without this a browser may sniff past the declared type and execute
    // something we validated as inert.
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${disposition}; filename="${safeName}"`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}
