export type ImageTurboErrorCode =
  | "file-too-large"
  | "invalid-type"
  | "compression-failed"
  | "upload-failed"
  | "aborted";

/**
 * Typed error used across the whole pipeline. `code` is a stable, machine-readable
 * discriminant so consumers can branch on failure kind without string-matching messages.
 */
export class ImageTurboError extends Error {
  readonly code: ImageTurboErrorCode;

  constructor(code: ImageTurboErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ImageTurboError";
    this.code = code;
  }
}

export function isImageTurboError(value: unknown): value is ImageTurboError {
  return value instanceof ImageTurboError;
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    throw new ImageTurboError("aborted", "The operation was aborted.");
  }
}
