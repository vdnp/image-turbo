import { registerImageMeta } from "./canvas-mock";

export interface MockImageFileOptions {
  name?: string;
  type?: string;
  /** Intrinsic pixel dimensions the mock decoder will report. */
  width?: number;
  height?: number;
  /** Byte size of the File (real bytes are allocated, so file.size is exact). */
  bytes?: number;
  /** When true, every decode path rejects for this file. */
  corrupt?: boolean;
  lastModified?: number;
}

export function createMockImageFile(options: MockImageFileOptions = {}): File {
  const {
    name = "photo.jpg",
    type = "image/jpeg",
    width = 1000,
    height = 800,
    bytes = 1_000_000,
    corrupt = false,
    lastModified = 1_700_000_000_000,
  } = options;

  const file = new File([new Uint8Array(bytes)], name, { type, lastModified });
  registerImageMeta(file, { width, height, corrupt });
  return file;
}
