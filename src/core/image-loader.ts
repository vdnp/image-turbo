import { ImageTurboError, throwIfAborted } from "./errors";

/**
 * A decoded image ready to be drawn onto a canvas, abstracting over
 * ImageBitmap (fast path) and HTMLImageElement (fallback path).
 */
export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Releases decoder-held memory. Always call when done drawing. */
  close(): void;
}

export async function loadImage(file: Blob, signal?: AbortSignal): Promise<DecodedImage> {
  throwIfAborted(signal);

  if (typeof createImageBitmap === "function") {
    const bitmap = await decodeBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  return decodeViaElement(file);
}

async function decodeBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    // "from-image" applies the EXIF orientation flag during decode, so photos
    // taken on rotated phones come out upright without manual matrix math.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    // Some engines reject the options bag itself rather than the image;
    // retry a bare decode before concluding the file is undecodable.
    try {
      return await createImageBitmap(file);
    } catch {
      throw new ImageTurboError(
        "compression-failed",
        "The file could not be decoded as an image.",
        { cause: error },
      );
    }
  }
}

function decodeViaElement(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);

  return new Promise<DecodedImage>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => {
          // Nothing decoder-held to release; dropping the element is enough.
        },
      });
    };
    img.onerror = () => {
      reject(
        new ImageTurboError("compression-failed", "The file could not be decoded as an image."),
      );
    };
    img.src = url;
  }).finally(() => {
    // Safe once load has settled: the element retains its decoded pixels.
    URL.revokeObjectURL(url);
  });
}
