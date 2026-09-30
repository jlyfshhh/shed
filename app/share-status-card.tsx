"use client";

import { useMemo, useState } from "react";
import {
  buildShareStatusCardModel,
  type ShareStatusCardInput,
  type ShareStatusCardModel,
} from "@/lib/share-status-card";

type Props = {
  data: ShareStatusCardInput;
  onClose: () => void;
  onNotice: (message: string) => void;
};

const WIDTH = 1080;
const HEIGHT = 1350;

function displayDate(value: string): string {
  if (!value) return "Today";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawShareCard(model: ShareStatusCardModel): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw a share image.");

  const ink = "#22262e";
  const muted = "#687079";
  const orange = "#e0701a";
  const pale = "#fff4df";
  const line = "#e4e1d8";
  const paper = "#ffffff";
  const green = "#2f7d4b";
  const danger = "#a14432";

  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#fff1ca";
  context.beginPath();
  context.arc(1010, 10, 360, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#edf3e8";
  context.beginPath();
  context.arc(30, 1320, 270, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = orange;
  context.font = "800 28px system-ui, -apple-system, sans-serif";
  context.letterSpacing = "5px";
  context.fillText("SHED · TODAY’S CARE", 76, 104);
  context.letterSpacing = "0px";

  // A care streak, when there is one, as a pill on the right of the header. It
  // is a plain count — the motivating number this card exists to let a keeper
  // share — and carries nothing private.
  if (model.streakDays > 0) {
    const label = `${model.streakDays}-DAY CARE STREAK`;
    context.font = "800 24px system-ui, -apple-system, sans-serif";
    context.letterSpacing = "2px";
    const pillW = context.measureText(label).width + 30 + 56;
    const pillX = 1004 - pillW;
    const pillY = 66;
    roundedRect(context, pillX, pillY, pillW, 50, 25);
    context.fillStyle = orange;
    context.fill();
    context.fillStyle = "#ffffff";
    // A small flame drawn as a teardrop, so the pill reads without relying on
    // an emoji font that may not exist on the renderer.
    context.beginPath();
    context.moveTo(pillX + 30, pillY + 15);
    context.quadraticCurveTo(pillX + 44, pillY + 27, pillX + 38, pillY + 38);
    context.quadraticCurveTo(pillX + 22, pillY + 38, pillX + 30, pillY + 15);
    context.fill();
    context.fillText(label, pillX + 54, pillY + 34);
    context.letterSpacing = "0px";
  }

  context.fillStyle = ink;
  context.font = "800 76px system-ui, -apple-system, sans-serif";
  const statusLines = wrapLines(context, model.status, 900).slice(0, 3);
  statusLines.forEach((lineText, index) => context.fillText(lineText, 76, 210 + index * 86));

  const statusBottom = 210 + (statusLines.length - 1) * 86;
  context.fillStyle = muted;
  context.font = "600 29px system-ui, -apple-system, sans-serif";
  context.fillText(displayDate(model.date), 76, statusBottom + 62);

  const progressY = statusBottom + 120;
  roundedRect(context, 76, progressY, 928, 22, 11);
  context.fillStyle = "#ebe8df";
  context.fill();
  roundedRect(context, 76, progressY, Math.max(model.completionPercent ? 24 : 0, 928 * model.completionPercent / 100), 22, 11);
  context.fillStyle = orange;
  context.fill();

  const statY = progressY + 72;
  const stats = [
    { label: "COMPLETE", value: model.completed, color: green },
    { label: "REMAINING", value: model.remaining, color: orange },
    { label: "OVERDUE", value: model.overdue, color: danger },
  ];
  stats.forEach((stat, index) => {
    const x = 76 + index * 316;
    roundedRect(context, x, statY, 296, 204, 28);
    context.fillStyle = paper;
    context.fill();
    context.strokeStyle = line;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = stat.color;
    context.font = "800 70px system-ui, -apple-system, sans-serif";
    context.fillText(String(stat.value), x + 28, statY + 91);
    context.fillStyle = muted;
    context.font = "800 21px system-ui, -apple-system, sans-serif";
    context.letterSpacing = "2px";
    context.fillText(stat.label, x + 28, statY + 148);
    context.letterSpacing = "0px";
  });

  let detailY = statY + 265;
  if (model.animalNames.length) {
    context.fillStyle = orange;
    context.font = "800 22px system-ui, -apple-system, sans-serif";
    context.letterSpacing = "3px";
    context.fillText("TODAY’S CARE LIST", 76, detailY);
    context.letterSpacing = "0px";
    context.fillStyle = ink;
    context.font = "750 37px system-ui, -apple-system, sans-serif";
    const visible = model.animalNames.slice(0, 12);
    const suffix = model.animalNames.length > visible.length ? ` + ${model.animalNames.length - visible.length} more` : "";
    const nameLines = wrapLines(context, `${visible.join(" · ")}${suffix}`, 910).slice(0, 4);
    nameLines.forEach((lineText, index) => context.fillText(lineText, 76, detailY + 58 + index * 48));
    detailY += 80 + nameLines.length * 48;
  }

  roundedRect(context, 76, Math.min(detailY + 10, 1070), 928, 120, 24);
  context.fillStyle = pale;
  context.fill();
  context.fillStyle = ink;
  context.font = "800 29px system-ui, -apple-system, sans-serif";
  context.fillText(`${model.animalCount} animals · ${model.scheduled} scheduled today`, 108, Math.min(detailY + 10, 1070) + 52);
  context.fillStyle = muted;
  context.font = "500 22px system-ui, -apple-system, sans-serif";
  const settled = model.skipped || model.missed
    ? `${model.skipped} skipped · ${model.missed} missed`
    : "A simple snapshot — not a detailed care record";
  context.fillText(settled, 108, Math.min(detailY + 10, 1070) + 88);

  context.fillStyle = ink;
  context.font = "800 30px system-ui, -apple-system, sans-serif";
  context.fillText("Good care shows.", 76, 1260);
  context.textAlign = "right";
  context.fillStyle = muted;
  context.font = "700 25px system-ui, -apple-system, sans-serif";
  context.fillText("animalroom.app", 1004, 1260);
  context.textAlign = "left";

  return canvas;
}

function cardBlob(model: ShareStatusCardModel): Blob {
  // Canvas.toBlob() is asynchronous. On iOS the callback can arrive after the
  // short-lived user gesture required by Web Share has expired, so a valid tap
  // opens nothing. The image is modest enough to encode synchronously and call
  // navigator.share() while that gesture is still active.
  const encoded = drawShareCard(model).toDataURL("image/png");
  const separator = encoded.indexOf(",");
  if (separator < 0) throw new Error("Couldn’t create the PNG.");
  const binary = atob(encoded.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "image/png" });
}

function cardFilename(date: string): string {
  return `shed-care-${date || "today"}.png`;
}

export default function ShareStatusCard({ data, onClose, onNotice }: Props) {
  const [includeAnimalNames, setIncludeAnimalNames] = useState(false);
  const [busy, setBusy] = useState<"share" | "download" | null>(null);
  const model = useMemo(
    () => buildShareStatusCardModel(data, { includeAnimalNames }),
    [data, includeAnimalNames],
  );

  const download = async () => {
    setBusy("download");
    try {
      const blob = cardBlob(model);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = cardFilename(model.date);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      onNotice("Private care card downloaded.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Couldn’t create the PNG.");
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setBusy("share");
    try {
      // Keep everything before navigator.share synchronous so iOS still sees
      // this as the direct result of the keeper's tap.
      const blob = cardBlob(model);
      const file = typeof File === "function"
        ? new File([blob], cardFilename(model.date), { type: "image/png" })
        : null;
      // Older desktop browsers do not expose either Web Share method even
      // though current TypeScript DOM types describe both as always present.
      const shareNavigator = navigator as unknown as {
        share?: (data?: ShareData) => Promise<void>;
        canShare?: (data?: ShareData) => boolean;
      };
      let canShareFile = false;
      if (file && typeof shareNavigator.share === "function" && typeof shareNavigator.canShare === "function") {
        try { canShareFile = shareNavigator.canShare({ files: [file] }); } catch { canShareFile = false; }
      }
      if (file && typeof shareNavigator.share === "function" && canShareFile) {
        await shareNavigator.share({ files: [file], title: "Today’s care in Shed" });
        onNotice("Care card ready to share.");
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = cardFilename(model.date);
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        onNotice("Sharing isn’t available here, so the PNG was downloaded instead.");
      }
    } catch (error) {
      // Closing the native share sheet is ordinary, not an error worth alarming
      // the keeper about.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        onNotice(error instanceof Error ? error.message : "Couldn’t share the PNG.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Share today’s care">
      <div className="sheet share-card-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <div><h2>Share today’s care</h2><small>Instagram-ready · 1080 × 1350 PNG</small></div>
          <button className="sheet-close" onClick={onClose} aria-label="Close share card">✕</button>
        </div>
        <div className="share-card-body">
          <div
            className="share-card-preview"
            role="img"
            aria-label={`${model.status} ${model.completed} complete, ${model.remaining} remaining, ${model.overdue} overdue.${model.animalNames.length ? ` Animals shown: ${model.animalNames.join(", ")}.` : " Animal names are hidden."}`}
          >
            <div className="share-preview-brand"><span>Shed · Today’s care</span>{model.streakDays > 0 ? <b className="share-preview-streak">{model.streakDays}-day care streak</b> : <small>{displayDate(model.date)}</small>}</div>
            <h3>{model.status}</h3>
            <div className="share-preview-progress"><span style={{ width: `${model.completionPercent}%` }} /></div>
            <div className="share-preview-stats">
              <p><b>{model.completed}</b><small>Complete</small></p>
              <p><b>{model.remaining}</b><small>Remaining</small></p>
              <p><b>{model.overdue}</b><small>Overdue</small></p>
            </div>
            {model.animalNames.length > 0 && <p className="share-preview-names"><small>Today’s care list</small>{model.animalNames.join(" · ")}</p>}
            <footer><b>Good care shows.</b><span>animalroom.app</span></footer>
          </div>

          <label className="share-name-toggle">
            <input type="checkbox" checked={includeAnimalNames} onChange={(event) => setIncludeAnimalNames(event.target.checked)} />
            <span><b>Include animal names</b><small>Off by default. Turn this on only when you’re comfortable posting their names publicly.</small></span>
          </label>
          <p className="share-privacy-note"><b>Private by default.</b> The PNG never includes keeper names, access codes, rewards, notes, local addresses, record IDs, or detailed history.</p>
          <div className="sheet-actions share-card-actions">
            <button className="ghost" onClick={() => void download()} disabled={busy !== null}>{busy === "download" ? "Drawing…" : "Download PNG"}</button>
            <button onClick={() => void share()} disabled={busy !== null}>{busy === "share" ? "Opening…" : "Share PNG"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
