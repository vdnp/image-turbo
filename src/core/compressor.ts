import { ImageTurboError, throwIfAborted } from "./errors";
import { canEncodeWebP, supportsOffscreenCanvas } from "./feature-detect";
import { loadImage } from "./image-loader";

export type OutputType = "image/webp" | "image/jpeg" | "image/png";

export type SkipReason = "under-size-threshold" | "output-larger-than-original";

export interface CompressOptions {
  /** Longest allowed width in px. The image is scaled down (never up) to fit. */
  maxWidth?: number;
  /** Longest allowed height in px. The image is scaled down (never up) to fit. */
  maxHeight?: number;
  /** Encoder quality in (0, 1]. Default 0.8. Ignored by PNG encoders. */
  quality?: number;
  /** Default "image/webp"; falls back to "image/jpeg" where WebP encoding is unsupported. */
  outputType?: OutputType;
  /** Files smaller than this (bytes) pass through untouched, skipping decode entirely. */
  skipCompressionUnder?: number;
  signal?: AbortSignal;
}

export interface CompressStats {
  originalBytes: number;
  compressedBytes: number;
  /** compressedBytes / originalBytes; 1 when compression was skipped. */
  ratio: number;
  durationMs: number;
  /** Output dimensions in px; 0 when compression was skipped before decoding. */
  width: number;
  height: number;
  /** The mime type actually produced (may differ from the requested outputType). */
  outputType: string;
  /** True when the original file was returned untouched. */
  skipped: boolean;
  skipReason?: SkipReason;
}

export interface CompressResult {
  file: File;
  stats: CompressStats;
}

const DEFAULT_QUALITY = 0.8;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * Pure client-side compression: decode → resize (contain, never upscale) → re-encode.
 * Uses OffscreenCanvas when available so the encode happens off the main thread's
 * layout path, falling back to a detached <canvas> element otherwise.
 */
export async function compressImage(
  input: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const {
    maxWidth,
    maxHeight,
    quality = DEFAULT_QUALITY,
    outputType = "image/webp",
    skipCompressionUnder = 0,
    signal,
  } = options;

  if (!(quality > 0 && quality <= 1)) {
    throw new RangeError(`quality must be in (0, 1], got ${quality}`);
  }
  if (maxWidth !== undefined && !(maxWidth >= 1)) {
    throw new RangeError(`maxWidth must be >= 1, got ${maxWidth}`);
  }
  if (maxHeight !== undefined && !(maxHeight >= 1)) {
    throw new RangeError(`maxHeight must be >= 1, got ${maxHeight}`);
  }

  throwIfAborted(signal);
  const startedAt = now();

  // Cheap size gate first: tiny files skip capability probing and decoding entirely.
  if (input.size < skipCompressionUnder) {
    return passThrough(input, startedAt, "under-size-threshold");
  }

  const targetType: OutputType =
    outputType === "image/webp" && !(await canEncodeWebP()) ? "image/jpeg" : outputType;
  throwIfAborted(signal);

  const image = await loadImage(input, signal);
  try {
    throwIfAborted(signal);

    const target = computeTargetSize(image.width, image.height, maxWidth, maxHeight);

    let blob: Blob | null;
    try {
      blob = await encode(image.source, target.width, target.height, targetType, quality);
    } catch (error) {
      if (error instanceof ImageTurboError) throw error;
      throw new ImageTurboError(
        "compression-failed",
        "The canvas encoder threw while producing the output image.",
        { cause: error },
      );
    }
    throwIfAborted(signal);

    if (!blob) {
      throw new ImageTurboError("compression-failed", "The canvas encoder returned an empty result.");
    }

    // Re-encoding an already-optimized image can inflate it; never ship a worse file.
    if (blob.size >= input.size) {
      return passThrough(input, startedAt, "output-larger-than-original", image);
    }

    const file = new File([blob], replaceExtension(input.name, blob.type), {
      type: blob.type,
      lastModified: input.lastModified,
    });

    return {
      file,
      stats: {
        originalBytes: input.size,
        compressedBytes: blob.size,
        ratio: blob.size / input.size,
        durationMs: now() - startedAt,
        width: target.width,
        height: target.height,
        outputType: blob.type,
        skipped: false,
      },
    };
  } finally {
    image.close();
  }
}

/**
 * "Contain" scaling: fits srcWidth×srcHeight inside maxWidth×maxHeight preserving
 * aspect ratio, never upscaling. Dimensions are rounded and floored at 1px.
 */
export function computeTargetSize(
  srcWidth: number,
  srcHeight: number,
  maxWidth?: number,
  maxHeight?: number,
): { width: number; height: number; resized: boolean } {
  const scale = Math.min(
    maxWidth !== undefined ? maxWidth / srcWidth : 1,
    maxHeight !== undefined ? maxHeight / srcHeight : 1,
    1,
  );

  if (scale >= 1) {
    return { width: srcWidth, height: srcHeight, resized: false };
  }

  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
    resized: true,
  };
}

type Drawable2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

async function encode(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: OutputType,
  quality: number,
): Promise<Blob | null> {
  if (supportsOffscreenCanvas()) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new ImageTurboError("compression-failed", "Could not acquire a 2d canvas context.");
    }
    draw(ctx, source, width, height, type);
    return canvas.convertToBlob({ type, quality });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ImageTurboError("compression-failed", "Could not acquire a 2d canvas context.");
  }
  draw(ctx, source, width, height, type);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function draw(
  ctx: Drawable2DContext,
  source: CanvasImageSource,
  width: number,
  height: number,
  type: OutputType,
): void {
  if (type === "image/jpeg") {
    // JPEG has no alpha channel; without this, transparent regions encode as black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(source, 0, 0, width, height);
}

function replaceExtension(name: string, type: string): string {
  const ext = EXTENSION_BY_TYPE[type];
  if (!ext) return name;
  const base = name.replace(/\.[^.\\/]+$/, "");
  return `${base || name}.${ext}`;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function passThrough(
  file: File,
  startedAt: number,
  skipReason: SkipReason,
  dimensions?: { width: number; height: number },
): CompressResult {
  return {
    file,
    stats: {
      originalBytes: file.size,
      compressedBytes: file.size,
      ratio: 1,
      durationMs: now() - startedAt,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      outputType: file.type,
      skipped: true,
      skipReason,
    },
  };
}
