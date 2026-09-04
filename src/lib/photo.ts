/**
 * Client-side photo preparation: shrink, stamp, and hand back a JPEG blob.
 *
 * Two jobs at once. Shrinking keeps us inside the free storage tier — a modern
 * phone camera produces 3–6 MB per shot, which at twenty reps would exhaust it
 * in days. Stamping burns the where and when into the pixels, so a photo
 * detached from its database row still carries its own evidence.
 *
 * 1000px on the long edge at quality 0.5 lands around 70–120 KB and stays
 * legible enough to read a school gate and its signage.
 */

const MAX_DIMENSION = 1000;
const QUALITY = 0.5;

export interface PhotoStamp {
  latitude: number | null;
  longitude: number | null;
  takenAt: Date;
}

export interface PreparedPhoto {
  blob: Blob;
  /** Object URL for the preview. The caller revokes it. */
  previewUrl: string;
  bytes: number;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through — some browsers refuse certain sources.
    }
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not read image"));
    };
    image.src = url;
  });
}

function formatCoords(stamp: PhotoStamp): string {
  if (stamp.latitude === null || stamp.longitude === null) {
    return "Location unavailable";
  }
  return `${stamp.latitude.toFixed(5)}, ${stamp.longitude.toFixed(5)}`;
}

export async function preparePhoto(
  file: File,
  stamp: PhotoStamp,
): Promise<PreparedPhoto> {
  const source = await loadBitmap(file);
  const sourceWidth = "width" in source ? source.width : 0;
  const sourceHeight = "height" in source ? source.height : 0;
  if (!sourceWidth || !sourceHeight) throw new Error("empty image");

  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();

  // --- the stamp -----------------------------------------------------------
  const lines = [
    "FIELD OPS",
    formatCoords(stamp),
    stamp.takenAt.toLocaleString(),
  ];

  const pad = Math.max(8, Math.round(width * 0.025));
  const fontSize = Math.max(11, Math.round(width * 0.03));
  const lineHeight = Math.round(fontSize * 1.35);
  const barHeight = pad * 2 + lineHeight * lines.length;

  ctx.fillStyle = "rgba(15, 23, 43, 0.62)"; // slate-900, translucent
  ctx.fillRect(0, height - barHeight, width, barHeight);

  ctx.textBaseline = "top";
  lines.forEach((line, index) => {
    const y = height - barHeight + pad + index * lineHeight;
    // The label is small and tinted; the facts below it are the readable part.
    if (index === 0) {
      ctx.font = `600 ${Math.round(fontSize * 0.8)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    } else {
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      ctx.fillStyle = "#ffffff";
    }
    ctx.fillText(line, pad, y);
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY),
  );
  if (!blob) throw new Error("could not encode image");

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    bytes: blob.size,
  };
}
