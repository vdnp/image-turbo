/**
 * A deterministic Canvas/ImageBitmap environment for jsdom.
 *
 * jsdom has no image decoder or canvas rasterizer, so we simulate both:
 * - image dimensions come from a WeakMap registry populated by test fixtures
 * - "encoding" produces a Blob whose size is a pure function of
 *   width * height * quality * encodedBytesPerPixel, so size assertions are exact
 */
import { vi, type Mock } from "vitest";

export interface MockImageMeta {
  width: number;
  height: number;
  corrupt?: boolean;
}

export interface EncodeRecord {
  via: "offscreen" | "html-canvas";
  type: string;
  quality: number | undefined;
  width: number;
  height: number;
}

export interface MockContext2D {
  fillStyle: string;
  fillRect: Mock;
  drawImage: Mock;
}

const imageMeta = new WeakMap<Blob, MockImageMeta>();

export function registerImageMeta(blob: Blob, meta: MockImageMeta): void {
  imageMeta.set(blob, meta);
}

interface MockState {
  /** When false, requests for image/webp encode fall back to image/png (mirrors old Safari). */
  webpEncodable: boolean;
  /** When true, createImageBitmap rejects the options bag (forces the bare-decode retry). */
  bitmapOptionsBagThrows: boolean;
  /** Knob for the deterministic encoded-size formula. */
  encodedBytesPerPixel: number;
  encodes: EncodeRecord[];
  lastBitmap: MockImageBitmap | null;
  lastContext: MockContext2D | null;
  /** Called synchronously inside createImageBitmap — lets tests abort mid-pipeline. */
  onDecode: ((blob: Blob) => void) | null;
}

export const mockState: MockState = {
  webpEncodable: true,
  bitmapOptionsBagThrows: false,
  encodedBytesPerPixel: 0.1,
  encodes: [],
  lastBitmap: null,
  lastContext: null,
  onDecode: null,
};

export function encodedSize(width: number, height: number, quality: number | undefined): number {
  return Math.max(1, Math.round(width * height * (quality ?? 1) * mockState.encodedBytesPerPixel));
}

export class MockImageBitmap {
  closed = false;

  constructor(
    public width: number,
    public height: number,
  ) {}

  close(): void {
    this.closed = true;
  }
}

async function mockCreateImageBitmap(blob: Blob, options?: unknown): Promise<MockImageBitmap> {
  if (options !== undefined && mockState.bitmapOptionsBagThrows) {
    throw new TypeError("createImageBitmap: the options argument is not supported");
  }
  mockState.onDecode?.(blob);
  const meta = imageMeta.get(blob);
  if (!meta || meta.corrupt) {
    throw new DOMException("The source image could not be decoded.", "InvalidStateError");
  }
  const bitmap = new MockImageBitmap(meta.width, meta.height);
  mockState.lastBitmap = bitmap;
  return bitmap;
}

function createMockContext(): MockContext2D {
  const ctx: MockContext2D = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  mockState.lastContext = ctx;
  return ctx;
}

function makeEncodedBlob(width: number, height: number, type: string, quality: number | undefined): Blob {
  const resolvedType = type === "image/webp" && !mockState.webpEncodable ? "image/png" : type;
  return new Blob([new Uint8Array(encodedSize(width, height, quality))], { type: resolvedType });
}

export class MockOffscreenCanvas {
  private ctx: MockContext2D | null = null;

  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext(id: string): MockContext2D | null {
    if (id !== "2d") return null;
    if (!this.ctx) this.ctx = createMockContext();
    return this.ctx;
  }

  async convertToBlob(options: { type?: string; quality?: number } = {}): Promise<Blob> {
    const { type = "image/png", quality } = options;
    mockState.encodes.push({ via: "offscreen", type, quality, width: this.width, height: this.height });
    return makeEncodedBlob(this.width, this.height, type, quality);
  }
}

// ---- HTMLCanvasElement fallback path (jsdom's canvas is a stub; we replace it) ----

export function installCanvasMocks(): void {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string) {
    if (id !== "2d") return null;
    const self = this as HTMLCanvasElement & { __mockCtx?: MockContext2D };
    if (!self.__mockCtx) self.__mockCtx = createMockContext();
    return self.__mockCtx;
  } as typeof HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.toBlob = function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type = "image/png",
    quality?: number,
  ) {
    mockState.encodes.push({ via: "html-canvas", type, quality, width: this.width, height: this.height });
    const blob = makeEncodedBlob(this.width, this.height, type, quality);
    queueMicrotask(() => callback(blob));
  };

  HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, type = "image/png") {
    const resolvedType = type === "image/webp" && !mockState.webpEncodable ? "image/png" : type;
    return `data:${resolvedType};base64,AA==`;
  };
}

// ---- Object URLs + HTMLImageElement fallback for the image-loader element path ----

const objectUrls = new Map<string, Blob>();
let urlCounter = 0;

function mockCreateObjectURL(blob: Blob): string {
  const url = `blob:mock/${++urlCounter}`;
  objectUrls.set(url, blob);
  return url;
}

function mockRevokeObjectURL(url: string): void {
  objectUrls.delete(url);
}

export class MockImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  set src(url: string) {
    const blob = objectUrls.get(url);
    const meta = blob ? imageMeta.get(blob) : undefined;
    queueMicrotask(() => {
      if (!meta || meta.corrupt) {
        this.onerror?.(new Error("image decode failed"));
        return;
      }
      this.naturalWidth = meta.width;
      this.naturalHeight = meta.height;
      this.onload?.();
    });
  }
}

/** Reinstalls fresh mocks and resets all recorded state. Run before each test. */
export function resetMockState(): void {
  mockState.webpEncodable = true;
  mockState.bitmapOptionsBagThrows = false;
  mockState.encodedBytesPerPixel = 0.1;
  mockState.encodes = [];
  mockState.lastBitmap = null;
  mockState.lastContext = null;
  mockState.onDecode = null;
  objectUrls.clear();

  (globalThis as Record<string, unknown>).createImageBitmap = vi.fn(mockCreateImageBitmap);
  (globalThis as Record<string, unknown>).OffscreenCanvas = MockOffscreenCanvas;
  URL.createObjectURL = vi.fn(mockCreateObjectURL);
  URL.revokeObjectURL = vi.fn(mockRevokeObjectURL);
}
