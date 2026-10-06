"use client";

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

// Printable enclosure labels. One card per animal: its name, enclosure, and a QR
// code pointing at `<origin>/?animal=<id>`, which opens that animal's quick-log
// when scanned. Rendered through a portal to document.body so the print styles
// can hide the rest of the app and lay the cards out cleanly on paper — they get
// cut out and laminated onto each enclosure.

export function EnclosureQrSheet({
  animals,
  onClose,
}: {
  animals: Array<{ id: string; name: string; species: string; enclosureName: string | null }>;
  onClose: () => void;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const sorted = useMemo(() => [...animals].sort((a, b) => a.name.localeCompare(b.name)), [animals]);
  const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(origin);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="sheet-backdrop qr-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qrsheet-title"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="sheet qr-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head qr-sheet-head">
          <div>
            <h2 id="qrsheet-title">Enclosure QR codes</h2>
            <small>Print, cut, and laminate one per enclosure. Scanning a code opens that animal’s quick-log.</small>
          </div>
          <div className="qr-sheet-actions">
            <button type="button" className="qr-print" onClick={() => window.print()}>
              Print
            </button>
            <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </header>
        <div className="sheet-body qr-sheet-body">
          {isLocal && (
            <p className="qr-sheet-note">
              You’re on a local address, so these codes point at <code>{origin}</code>. Open this page on your live Shed
              URL before printing so a scanned code reaches the app.
            </p>
          )}
          {sorted.length === 0 ? (
            <p className="quicklog-muted">No animals yet — add one in Manage records first.</p>
          ) : (
            <div className="qr-grid">
              {sorted.map((animal) => (
                <article className="qr-card" key={animal.id}>
                  <QRCodeSVG className="qr-card-code" value={`${origin}/?animal=${encodeURIComponent(animal.id)}`} size={200} level="M" marginSize={4} />
                  <h3 className="qr-card-name">{animal.name}</h3>
                  <p className="qr-card-scan">Scan to log care</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
