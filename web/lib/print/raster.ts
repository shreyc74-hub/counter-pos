// Prints a line of text as a picture, for sizes the printer's own fonts don't have
// (1¼× item names). Uses the standard ESC/POS raster command GS v 0, which cheap
// 58/80 mm printers support. Browser only (it draws the text on a canvas).

const DOTS_PER_CHAR = 12; // the printer's normal font is 12 × 24 dots

/** GS v 0 bytes for one line of bold 1¼× text, or null if there is no canvas (tests, server). */
export function rasterLine(text: string, widthChars: number, align: "left" | "center" | "right" = "left"): Uint8Array | null {
  if (typeof document === "undefined") return null;
  const widthDots = widthChars * DOTS_PER_CHAR; // 384 for 58 mm, 576 for 80 mm
  const height = 30; // 1¼ × 24
  const canvas = document.createElement("canvas");
  canvas.width = widthDots;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, widthDots, height);
  ctx.fillStyle = "#000";
  ctx.font = 'bold 25px "Roboto Mono", "DejaVu Sans Mono", "Courier New", monospace'; // ~15 dots per character
  ctx.textBaseline = "middle";
  const w = Math.min(widthDots, ctx.measureText(text).width);
  const x = align === "center" ? (widthDots - w) / 2 : align === "right" ? widthDots - w : 0;
  ctx.fillText(text, x, height / 2 + 1, widthDots);
  const px = ctx.getImageData(0, 0, widthDots, height).data;
  const dark = (x: number, y: number) => {
    const i = (y * widthDots + x) * 4;
    return px[i] + px[i + 1] + px[i + 2] < 384; // below mid-grey
  };
  // Send only up to the last inked column: less to send over Bluetooth, so it prints sooner.
  let right = 0;
  for (let y = 0; y < height; y++) for (let x = right; x < widthDots; x++) if (dark(x, y)) right = x;
  const bytesPerRow = Math.max(1, Math.ceil((right + 1) / 8));
  const out = new Uint8Array(8 + bytesPerRow * height);
  out.set([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, height & 0xff, height >> 8]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x <= right; x++) if (dark(x, y)) out[8 + y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return out;
}
