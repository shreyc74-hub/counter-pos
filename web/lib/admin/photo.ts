// Turns a photo picked on the phone/computer into a small JPEG for the menu (a data URL),
// so it uploads quickly and loads fast on the counter. Full-size camera photos are ~3–5 MB;
// these come out around 20–60 KB.

const MAX_SIDE = 480; // px: tiles are at most ~300 px wide on the tablet
const MAX_LENGTH = 280_000; // characters; the database accepts up to 300,000

export async function photoToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't a photo.");
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize photos.");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_LENGTH) return url;
  }
  throw new Error("That photo is too detailed to shrink. Try a different one.");
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't open that photo. Try a JPG or PNG."));
    };
    img.src = url;
  });
}
