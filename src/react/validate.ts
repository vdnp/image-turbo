import { ImageTurboError } from "../core/errors";

/**
 * react-dropzone-style accept map: mime type (or wildcard pattern) → file extensions.
 * A file is accepted when its mime type matches any key OR its name ends with any extension.
 */
export type AcceptMap = Record<string, string[]>;

export const DEFAULT_ACCEPT: AcceptMap = { "image/*": [] };

export function validateFile(
  file: File,
  accept?: AcceptMap,
  maxSize?: number,
): ImageTurboError | null {
  if (maxSize !== undefined && file.size > maxSize) {
    return new ImageTurboError(
      "file-too-large",
      `"${file.name}" is ${file.size} bytes; the limit is ${maxSize} bytes.`,
    );
  }
  if (accept && !matchesAccept(file, accept)) {
    return new ImageTurboError(
      "invalid-type",
      `"${file.name}" (${file.type || "unknown type"}) is not an accepted file type.`,
    );
  }
  return null;
}

function matchesAccept(file: File, accept: AcceptMap): boolean {
  return Object.entries(accept).some(([pattern, extensions]) => {
    if (matchesMime(file.type, pattern)) return true;
    const name = file.name.toLowerCase();
    return extensions.some((ext) => name.endsWith(ext.toLowerCase()));
  });
}

function matchesMime(type: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "*/*") return true;
  if (pattern.endsWith("/*")) return type.startsWith(pattern.slice(0, -1));
  return type === pattern;
}

/** Flattens an accept map into the string form the <input accept> attribute expects. */
export function acceptToInputAttr(accept?: AcceptMap): string {
  if (!accept) return "image/*";
  return Object.entries(accept)
    .flatMap(([mime, extensions]) => [mime, ...extensions])
    .join(",");
}
