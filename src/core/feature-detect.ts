/**
 * Lazy, cached browser capability probes. Everything here must be safe to import
 * during SSR: no browser API is touched at module scope, only inside the functions.
 */

let webpProbe: Promise<boolean> | null = null;

export function supportsOffscreenCanvas(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  );
}

/**
 * Whether this browser can *encode* WebP (decoding support is broader than encoding —
 * e.g. Safari < 17 decodes WebP but silently falls back to PNG when asked to encode it).
 * The probe encodes a 1x1 canvas once and caches the promise for the session.
 */
export function canEncodeWebP(): Promise<boolean> {
  if (webpProbe === null) {
    webpProbe = probeWebPEncode();
  }
  return webpProbe;
}

async function probeWebPEncode(): Promise<boolean> {
  try {
    if (supportsOffscreenCanvas()) {
      const canvas = new OffscreenCanvas(1, 1);
      // convertToBlob rejects on a canvas that never had a rendering context
      canvas.getContext("2d");
      const blob = await canvas.convertToBlob({ type: "image/webp" });
      return blob.type === "image/webp";
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      return canvas.toDataURL("image/webp").startsWith("data:image/webp");
    }
    return false;
  } catch {
    return false;
  }
}

/** Test hook: clears the cached probe so capability changes between tests are observed. */
export function resetFeatureDetectionCache(): void {
  webpProbe = null;
}
