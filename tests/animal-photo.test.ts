import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PHOTO_BASE64_LENGTH, base64ToBytes, parsePhotoDataUrl } from "../lib/animal-photo.ts";

const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

test("accepts the image types we serve back", () => {
  const parsed = parsePhotoDataUrl(jpeg);
  assert.ok("photo" in parsed);
  assert.equal(parsed.photo.mime, "image/jpeg");
  assert.equal(parsed.photo.base64, "/9j/4AAQSkZJRg==");
  assert.equal(parsed.photo.byteSize, 10);
  assert.ok("photo" in parsePhotoDataUrl("data:image/png;base64,iVBORw0KGgo="));
  assert.ok("photo" in parsePhotoDataUrl("data:image/webp;base64,UklGRhoAAABX"));
});

test("rejects anything that isn't an image we can render", () => {
  // An SVG would be served back with its own mime type and could carry script.
  assert.deepEqual(parsePhotoDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), { error: "Photos need to be a JPEG, PNG, or WebP." });
  assert.deepEqual(parsePhotoDataUrl("data:text/html;base64,PGgxPmhpPC9oMT4="), { error: "Photos need to be a JPEG, PNG, or WebP." });
  assert.deepEqual(parsePhotoDataUrl("https://example.com/cat.jpg"), { error: "That file didn't look like an image." });
  assert.deepEqual(parsePhotoDataUrl("data:image/jpeg;base64,not base64!"), { error: "That file didn't look like an image." });
  assert.deepEqual(parsePhotoDataUrl(""), { error: "Choose a photo to upload." });
  assert.deepEqual(parsePhotoDataUrl(null), { error: "Choose a photo to upload." });
  assert.deepEqual(parsePhotoDataUrl({ dataUrl: jpeg }), { error: "Choose a photo to upload." });
});

test("caps the payload so a hand-rolled request can't fill the database", () => {
  const huge = `data:image/jpeg;base64,${"A".repeat(MAX_PHOTO_BASE64_LENGTH + 4)}`;
  assert.deepEqual(parsePhotoDataUrl(huge), { error: "That photo is too large — try a smaller one." });
});

test("byte size accounts for base64 padding", () => {
  const one = parsePhotoDataUrl("data:image/png;base64,QQ==");
  const two = parsePhotoDataUrl("data:image/png;base64,QUI=");
  const three = parsePhotoDataUrl("data:image/png;base64,QUJD");
  assert.ok("photo" in one && one.photo.byteSize === 1);
  assert.ok("photo" in two && two.photo.byteSize === 2);
  assert.ok("photo" in three && three.photo.byteSize === 3);
});

test("decoding round-trips the bytes", () => {
  assert.deepEqual([...base64ToBytes("QUJD")], [65, 66, 67]);
  assert.deepEqual([...base64ToBytes("/9j/")], [255, 216, 255]);
});
