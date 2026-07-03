import { expect, test } from "@playwright/test";

/**
 * A heavy JPEG fixture generated in the browser itself (no binary committed to the
 * repo): a gradient with per-pixel noise so the JPEG encoder can't compress it away.
 * ~2500x2000 at quality 0.98 lands in the multi-megabyte range, and decoding +
 * re-encoding it keeps the "compressing" state visible long enough to assert.
 */
let jpeg: Buffer;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  const base64 = await page.evaluate(async () => {
    const width = 2500;
    const height = 2000;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(width, height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const p = i / 4;
      const x = p % width;
      const y = (p / width) | 0;
      const noise = (Math.random() - 0.5) * 48;
      d[i] = Math.max(0, Math.min(255, (x / width) * 255 + noise));
      d[i + 1] = Math.max(0, Math.min(255, (y / height) * 255 + noise));
      d[i + 2] = Math.max(0, Math.min(255, 128 + Math.sin(x / 24) * 96 + noise));
      d[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.98),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
  jpeg = Buffer.from(base64, "base64");
  await page.close();
});

test("prebuilt dropzone: compresses to a much smaller WebP and uploads it", async ({ page }) => {
  await page.goto("/prebuilt");
  const zone = page.locator(".it-dropzone");
  const input = zone.locator('input[type="file"]');

  const putRequestPromise = page.waitForRequest(
    (req) => req.method() === "PUT" && req.url().includes("/api/mock-bucket/"),
  );

  await input.setInputFiles({ name: "large-photo.jpg", mimeType: "image/jpeg", buffer: jpeg });

  // busy phase 1: compressing, with the optimistic preview already visible
  await expect(zone).toHaveAttribute("data-status", "compressing");
  await expect(zone.locator(".it-preview")).toBeVisible();
  await expect(zone.locator(".it-progress")).toBeVisible();

  // busy phase 2: uploading, with a determinate progress bar
  await expect(zone).toHaveAttribute("data-status", "uploading");
  await expect(zone.locator('[role="progressbar"]')).toBeVisible();

  // the core promise of the library, asserted on the wire: the payload that reaches
  // the bucket is WebP and dramatically smaller than the dropped JPEG. The byte count
  // comes from the mock bucket itself (x-mock-bytes) — CDP can't expose binary XHR
  // bodies via postDataBuffer(), and the server-side measurement is stronger anyway.
  const putRequest = await putRequestPromise;
  expect(putRequest.headers()["content-type"]).toBe("image/webp");
  const putResponse = await putRequest.response();
  const receivedBytes = Number(putResponse!.headers()["x-mock-bytes"]);
  expect(jpeg.byteLength).toBeGreaterThan(2_000_000); // fixture really is heavy
  expect(receivedBytes).toBeGreaterThan(0);
  expect(receivedBytes).toBeLessThan(jpeg.byteLength / 2);
  console.log(
    `compression: ${jpeg.byteLength} B (jpeg) -> ${receivedBytes} B (webp), ` +
      `${Math.round((1 - receivedBytes / jpeg.byteLength) * 100)}% smaller`,
  );

  await expect(zone).toHaveAttribute("data-status", "success");
  await expect(zone.locator(".it-stats")).toContainText("% smaller");
  await expect(page.getByTestId("uploaded-key")).toContainText("uploads/");

  // the remove button clears the zone without reopening the picker
  await zone.getByRole("button", { name: "Remove image" }).click();
  await expect(zone).toHaveAttribute("data-status", "idle");
});

test("headless hook drives a fully custom UI through the same pipeline", async ({ page }) => {
  await page.goto("/headless");
  const status = page.getByTestId("headless-status");

  await page
    .getByTestId("headless-input")
    .setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: jpeg });

  await expect(status).toHaveText("Compressing…");
  await expect(page.getByTestId("headless-preview")).toBeVisible();
  await expect(status).toHaveText(/Uploading… \d+%/);
  await expect(status).toHaveText("Done");
  await expect(page.getByTestId("headless-stats")).toContainText("1920×");
  await expect(page.getByTestId("headless-result")).toContainText("uploads/");

  await page.getByTestId("headless-reset").click();
  await expect(status).toHaveText("Click or drop an image");
});

test("rejects non-image files with a friendly inline error", async ({ page }) => {
  await page.goto("/prebuilt");
  const zone = page.locator(".it-dropzone");

  await zone
    .locator('input[type="file"]')
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });

  await expect(zone).toHaveAttribute("data-status", "error");
  await expect(zone.locator(".it-error")).toContainText("not an accepted file type");
});

test("drag-over highlights the dropzone and clears on leave", async ({ page }) => {
  await page.goto("/prebuilt");
  const zone = page.locator(".it-dropzone");
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  await zone.dispatchEvent("dragenter", { dataTransfer });
  await expect(zone).toHaveAttribute("data-drag-active", "true");

  await zone.dispatchEvent("dragleave", { dataTransfer });
  await expect(zone).not.toHaveAttribute("data-drag-active", "true");
});
