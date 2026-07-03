import { describe, expect, it, vi, type Mock } from "vitest";
import { loadImage } from "../src/core/image-loader";
import { mockState, MockImage } from "./canvas-mock";
import { createMockImageFile } from "./fixtures";

describe("loadImage", () => {
  it("decodes via createImageBitmap with EXIF orientation applied", async () => {
    const file = createMockImageFile({ width: 3000, height: 2000 });

    const image = await loadImage(file);

    expect(image.width).toBe(3000);
    expect(image.height).toBe(2000);
    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
    });
  });

  it("retries a bare decode when the engine rejects the options bag", async () => {
    mockState.bitmapOptionsBagThrows = true;
    const file = createMockImageFile({ width: 640, height: 480 });

    const image = await loadImage(file);

    expect(image.width).toBe(640);
    expect(image.height).toBe(480);
    const decodeMock = globalThis.createImageBitmap as unknown as Mock;
    expect(decodeMock).toHaveBeenCalledTimes(2);
    expect(decodeMock).toHaveBeenNthCalledWith(2, file);
  });

  it("close() releases the underlying bitmap", async () => {
    const file = createMockImageFile();

    const image = await loadImage(file);
    image.close();

    expect(mockState.lastBitmap?.closed).toBe(true);
  });

  it("wraps undecodable input in a compression-failed error", async () => {
    const file = createMockImageFile({ corrupt: true });

    await expect(loadImage(file)).rejects.toMatchObject({
      name: "ImageTurboError",
      code: "compression-failed",
    });
  });

  describe("HTMLImageElement fallback (no createImageBitmap)", () => {
    it("decodes via an image element and revokes the object URL", async () => {
      vi.stubGlobal("createImageBitmap", undefined);
      vi.stubGlobal("Image", MockImage);
      const file = createMockImageFile({ width: 1200, height: 900 });

      const image = await loadImage(file);

      expect(image.width).toBe(1200);
      expect(image.height).toBe(900);

      const createSpy = URL.createObjectURL as unknown as Mock;
      const url = createSpy.mock.results[0]?.value;
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    });

    it("rejects and still revokes the URL when the element fails to decode", async () => {
      vi.stubGlobal("createImageBitmap", undefined);
      vi.stubGlobal("Image", MockImage);
      const file = createMockImageFile({ corrupt: true });

      await expect(loadImage(file)).rejects.toMatchObject({ code: "compression-failed" });
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    });
  });
});
