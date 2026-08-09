import assert from "node:assert/strict";
import test from "node:test";
import { attachmentHeaders, checkAttachment, MAX_IMAGE_BYTES } from "../lib/attachments.ts";

const bytes = (...values: number[]) => Uint8Array.from(values);
const pad = (head: number[], length = 64) =>
  Uint8Array.from([...head, ...new Array(Math.max(0, length - head.length)).fill(0)]);

const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

test("the formats the interface actually supports are accepted", () => {
  for (const [name, sample, mime] of [
    ["jpeg", JPEG, "image/jpeg"],
    ["png", PNG, "image/png"],
    ["webp", WEBP, "image/webp"],
  ] as const) {
    const result = checkAttachment(sample, "image", mime);
    assert.equal(result.ok, true, `${name} should be accepted`);
    if (result.ok) assert.equal(result.mime, mime);
  }
  const pdf = checkAttachment(PDF, "document", "application/pdf");
  assert.equal(pdf.ok, true);
});

test("script-capable formats are refused however they are labelled", () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
  const xml = new TextEncoder().encode('<?xml version="1.0"?><root/>');
  for (const hostile of [svg, html, xml]) {
    // Including when they claim to be a format we do accept.
    for (const claim of [undefined, "image/png", "image/svg+xml", "text/html"]) {
      const result = checkAttachment(hostile, "image", claim);
      assert.equal(result.ok, false, `refused regardless of the declared type (${claim})`);
    }
  }
});

test("a declared type that disagrees with the bytes is refused", () => {
  // The restore path's exact hazard: the bundle says one thing, the bytes are
  // another, and the stored type is what gets served back.
  const result = checkAttachment(PNG, "image", "text/html");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /text\/html/);
});

test("the detected type is returned, not the declared one", () => {
  const result = checkAttachment(JPEG, "image");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.mime, "image/jpeg");
});

test("a PDF cannot be stored where an image belongs", () => {
  assert.equal(checkAttachment(PDF, "image", "application/pdf").ok, false);
});

test("empty and oversized attachments are refused", () => {
  assert.equal(checkAttachment(bytes(), "image").ok, false);
  const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
  huge.set([0xff, 0xd8, 0xff]);
  assert.equal(checkAttachment(huge, "image").ok, false);
});

test("a polyglot that merely starts with a valid header is still only that type", () => {
  // JPEG magic followed by markup: it is served as image/jpeg with nosniff, so
  // a browser will not treat the trailing markup as a document.
  const polyglot = Uint8Array.from([
    0xff, 0xd8, 0xff, ...new TextEncoder().encode("<script>alert(1)</script>"),
  ]);
  const result = checkAttachment(polyglot, "image");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.mime, "image/jpeg");
  assert.equal(attachmentHeaders(result.ok ? result.mime : "")["X-Content-Type-Options"], "nosniff");
});

test("attachment responses cannot be sniffed or run as a page", () => {
  const headers = attachmentHeaders("image/jpeg", { filename: '../../evil".jpg\r\nX-Injected: yes', inline: true });
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Content-Security-Policy"], /sandbox/);
  // Dots are fine — extensions need them, and a name cannot traverse anything
  // once the separators are gone. What must not survive is a quote that would
  // end the filename early, a separator, or a newline that would start a new
  // header.
  const disposition = headers["Content-Disposition"];
  const quoted = disposition.match(/filename="([^"]*)"$/);
  assert.ok(quoted, "the filename should be a single quoted value");
  assert.doesNotMatch(quoted[1], /["\\/\r\n]/, "quotes, separators, and newlines must not survive inside it");
  assert.doesNotMatch(disposition, /\r|\n/, "no newline may reach the header at all");
  assert.match(attachmentHeaders("application/pdf")["Content-Disposition"], /^attachment;/);
});
