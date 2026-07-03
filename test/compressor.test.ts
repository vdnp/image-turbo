import { describe, expect, it, vi } from "vitest";
import { compressImage, computeTargetSize } from "../src/core/compressor";
import { ImageTurboError } from "../src/core/errors";
import { mockState } from "./canvas-mock";
import { createMockImageFile } from "./fixtures";

describe("computeTargetSize", () => {
  it("constrains a landscape image by maxWidth", () => {
    expect(computeTargetSize(4000, 3000, 1920, 1920)).toEqual({
      width: 1920,
      height: 1440,
      resized: true,
    });
  });

  it("constrains a portrait image by maxHeight", () => {
    expect(computeTargetSize(3000, 4000, 1920, 1920)).toEqual({
      width: 1440,
      height: 1920,
      resized: true,
    });
  });

  it("never upscales images already within bounds", () => {
    expect(computeTargetSize(800, 600, 1920, 1920)).toEqual({
      width: 800,
      height: 600,
      resized: false,
    });
  });

  it("scales by width only when maxHeight is omitted", () => {
    expect(computeTargetSize(4000, 3000, 2000, undefined)).toEqual({
      width: 2000,
      height: 1500,
      resized: true,
    });
  });

  it("returns source dimensions when no limits are given", () => {
    expect(computeTargetSize(4000, 3000)).toEqual({
      width: 4000,
      height: 3000,
      resized: false,
    });
  });

  it("floors extreme aspect ratios at 1px", () => {
    expect(computeTargetSize(10000, 5, 100, undefined)).toEqual({
      width: 100,
      height: 1,
      resized: true,
    });
  });
});

describe("compressImage", () => {
  it("resizes and re-encodes a heavy JPEG to WebP", async () => {
    const file = createMockImageFile({
      name: "holiday.jpg",
      type: "image/jpeg",
      width: 4000,
      height: 3000,
      bytes: 10_000_000,
    });

    const { file: output, stats } = await compressImage(file, {
      maxWidth: 1920,
      maxHeight: 1920,
      quality: 0.8,
    });

    // mock encoder: 1920 * 1440 * 0.8 * 0.1 bytes/px = 221,184 bytes
    expect(output.type).toBe("image/webp");
    expect(output.name).toBe("holiday.webp");
    expect(output.size).toBe(221_184);
    expect(output.lastModified).toBe(file.lastModified);

    expect(stats).toMatchObject({
      originalBytes: 10_000_000,
      compressedBytes: 221_184,
      width: 1920,
      height: 1440,
      outputType: "image/webp",
      skipped: false,
    });
    expect(stats.ratio).toBeCloseTo(221_184 / 10_000_000, 6);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);

    expect(mockState.lastContext?.drawImage).toHaveBeenCalledWith(
      mockState.lastBitmap,
      0,
      0,
      1920,
      1440,
    );
  });

  it("passes the quality option through to the encoder", async () => {
    const file = createMockImageFile({ width: 1000, height: 1000, bytes: 2_000_000 });

    await compressImage(file, { quality: 0.5 });

    expect(mockState.encodes.at(-1)).toMatchObject({
      type: "image/webp",
      quality: 0.5,
    });
  });

  it("releases the decoded bitmap after encoding", async () => {
    const file = createMockImageFile({ bytes: 2_000_000 });

    await compressImage(file, { maxWidth: 500 });

    expect(mockState.lastBitmap?.closed).toBe(true);
  });

  it("passes tiny files through without decoding them", async () => {
    const file = createMockImageFile({ bytes: 50_000 });

    const { file: output, stats } = await compressImage(file, {
      skipCompressionUnder: 100_000,
    });

    expect(output).toBe(file);
    expect(stats).toMatchObject({
      skipped: true,
      skipReason: "under-size-threshold",
      ratio: 1,
      originalBytes: 50_000,
      compressedBytes: 50_000,
    });
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it("returns the original when the compressed output would be larger", async () => {
    // 100x100 at q0.8 encodes to 800 mock bytes — bigger than the 500-byte original
    const file = createMockImageFile({ width: 100, height: 100, bytes: 500 });

    const { file: output, stats } = await compressImage(file);

    expect(output).toBe(file);
    expect(stats).toMatchObject({
      skipped: true,
      skipReason: "output-larger-than-original",
      ratio: 1,
      width: 100,
      height: 100,
    });
  });

  it("falls back to JPEG with a white matte when WebP encoding is unsupported", async () => {
    mockState.webpEncodable = false;
    const file = createMockImageFile({
      name: "holiday.jpg",
      width: 4000,
      height: 3000,
      bytes: 10_000_000,
    });

    const { file: output } = await compressImage(file, { maxWidth: 1920 });

    expect(output.type).toBe("image/jpeg");
    expect(output.name).toBe("holiday.jpg");
    expect(mockState.encodes.at(-1)).toMatchObject({ type: "image/jpeg" });
    // JPEG has no alpha, so the canvas must be pre-filled white
    expect(mockState.lastContext?.fillStyle).toBe("#fff");
    expect(mockState.lastContext?.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1440);
  });

  it("uses the HTMLCanvasElement path when OffscreenCanvas is unavailable", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const file = createMockImageFile({ width: 2000, height: 2000, bytes: 5_000_000 });

    const { file: output, stats } = await compressImage(file, { maxWidth: 1000 });

    expect(output.type).toBe("image/webp");
    expect(output.size).toBe(80_000); // 1000 * 1000 * 0.8 * 0.1
    expect(stats).toMatchObject({ width: 1000, height: 1000, skipped: false });
    expect(mockState.encodes.at(-1)).toMatchObject({ via: "html-canvas", type: "image/webp" });
  });

  it("rejects with an aborted error when the signal is already aborted", async () => {
    const file = createMockImageFile();
    const controller = new AbortController();
    controller.abort();

    const promise = compressImage(file, { signal: controller.signal });

    await expect(promise).rejects.toBeInstanceOf(ImageTurboError);
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it("aborts mid-pipeline and still releases the decoded bitmap", async () => {
    const file = createMockImageFile({ bytes: 2_000_000 });
    const controller = new AbortController();
    mockState.onDecode = () => controller.abort();

    await expect(compressImage(file, { signal: controller.signal })).rejects.toMatchObject({
      code: "aborted",
    });
    expect(mockState.lastBitmap?.closed).toBe(true);
    expect(mockState.encodes).toHaveLength(1); // only the WebP capability probe, no real encode
  });

  it("wraps decode failures in a compression-failed error", async () => {
    const file = createMockImageFile({ corrupt: true });

    await expect(compressImage(file)).rejects.toMatchObject({
      name: "ImageTurboError",
      code: "compression-failed",
    });
  });

  it("rejects invalid quality and dimension options", async () => {
    const file = createMockImageFile();

    await expect(compressImage(file, { quality: 1.5 })).rejects.toThrow(RangeError);
    await expect(compressImage(file, { quality: 0 })).rejects.toThrow(RangeError);
    await expect(compressImage(file, { maxWidth: 0 })).rejects.toThrow(RangeError);
    await expect(compressImage(file, { maxHeight: -5 })).rejects.toThrow(RangeError);
  });
});
