import { describe, expect, it, vi } from "vitest";
import {
  canEncodeWebP,
  resetFeatureDetectionCache,
  supportsOffscreenCanvas,
} from "../src/core/feature-detect";
import { mockState } from "./canvas-mock";

describe("supportsOffscreenCanvas", () => {
  it("detects the mocked OffscreenCanvas", () => {
    expect(supportsOffscreenCanvas()).toBe(true);
  });

  it("reports false when OffscreenCanvas is missing", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    expect(supportsOffscreenCanvas()).toBe(false);
  });
});

describe("canEncodeWebP", () => {
  it("probes via OffscreenCanvas once and caches the result", async () => {
    await expect(canEncodeWebP()).resolves.toBe(true);
    await expect(canEncodeWebP()).resolves.toBe(true);

    // a single 1x1 probe encode despite two calls
    expect(mockState.encodes).toHaveLength(1);
    expect(mockState.encodes[0]).toMatchObject({
      via: "offscreen",
      type: "image/webp",
      width: 1,
      height: 1,
    });
  });

  it("reports false when the encoder silently falls back to PNG", async () => {
    mockState.webpEncodable = false;
    await expect(canEncodeWebP()).resolves.toBe(false);
  });

  it("falls back to toDataURL probing when OffscreenCanvas is missing", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);

    await expect(canEncodeWebP()).resolves.toBe(true);

    resetFeatureDetectionCache();
    mockState.webpEncodable = false;
    await expect(canEncodeWebP()).resolves.toBe(false);
  });

  it("re-probes after the cache is reset", async () => {
    await canEncodeWebP();
    resetFeatureDetectionCache();
    await canEncodeWebP();

    expect(mockState.encodes).toHaveLength(2);
  });
});
