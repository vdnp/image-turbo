import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadToPresignedUrl } from "../src/adapters/presigned-url";
import type { PresignedUrlOptions } from "../src/adapters/presigned-url";

class MockXHR {
  static instances: MockXHR[] = [];

  upload: { onprogress: ((event: Partial<ProgressEvent>) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  status = 0;
  timeout = 0;
  withCredentials = false;
  aborted = false;
  opened: { method: string; url: string } | null = null;
  sent: unknown = null;
  requestHeaders: Record<string, string> = {};
  private responseHeaders: Record<string, string> = {};

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string): void {
    this.opened = { method, url };
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name.toLowerCase()] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  // ---- test drivers ----
  emitProgress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable });
  }

  respond(status: number, headers: Record<string, string> = {}): void {
    this.status = status;
    this.responseHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    this.onload?.();
  }

  failNetwork(): void {
    this.onerror?.();
  }

  fireTimeout(): void {
    this.ontimeout?.();
  }
}

beforeEach(() => {
  MockXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", MockXHR);
});

function startUpload(options?: PresignedUrlOptions, fileType = "image/webp") {
  const controller = new AbortController();
  const onProgress = vi.fn();
  const file = new File([new Uint8Array(1000)], "photo.webp", { type: fileType });
  const promise = uploadToPresignedUrl(
    "https://bucket.example.com/key?signature=abc",
    file,
    { signal: controller.signal, onProgress },
    options,
  );
  const xhr = MockXHR.instances.at(-1);
  return { promise, xhr, controller, onProgress, file };
}

describe("uploadToPresignedUrl", () => {
  it("PUTs the file to the URL with the file's Content-Type", async () => {
    const { promise, xhr, file } = startUpload();

    expect(xhr?.opened).toEqual({
      method: "PUT",
      url: "https://bucket.example.com/key?signature=abc",
    });
    expect(xhr?.sent).toBe(file);
    expect(xhr?.requestHeaders["content-type"]).toBe("image/webp");

    xhr!.respond(200);
    await expect(promise).resolves.toEqual({ status: 200, etag: null });
  });

  it("lets user headers override Content-Type and adds extra headers", async () => {
    const { promise, xhr } = startUpload({
      headers: { "Content-Type": "application/octet-stream", "x-amz-acl": "private" },
      withCredentials: true,
      timeoutMs: 30_000,
    });

    expect(xhr?.requestHeaders["content-type"]).toBe("application/octet-stream");
    expect(xhr?.requestHeaders["x-amz-acl"]).toBe("private");
    expect(xhr?.withCredentials).toBe(true);
    expect(xhr?.timeout).toBe(30_000);

    xhr!.respond(200);
    await promise;
  });

  it("maps upload progress events to fractions and finishes at 1", async () => {
    const { promise, xhr, onProgress } = startUpload();

    xhr!.emitProgress(250, 1000);
    expect(onProgress).toHaveBeenLastCalledWith(0.25);
    xhr!.emitProgress(750, 1000);
    expect(onProgress).toHaveBeenLastCalledWith(0.75);

    xhr!.respond(200, { ETag: '"d41d8cd9"' });
    await expect(promise).resolves.toEqual({ status: 200, etag: '"d41d8cd9"' });
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it("ignores progress events without computable length", async () => {
    const { promise, xhr, onProgress } = startUpload();

    xhr!.emitProgress(500, 0, false);
    xhr!.emitProgress(500, 0, true); // total 0 would divide by zero
    expect(onProgress).not.toHaveBeenCalled();

    xhr!.respond(204);
    await promise;
  });

  it("rejects non-2xx responses with upload-failed", async () => {
    const { promise, xhr } = startUpload();

    xhr!.respond(403);
    await expect(promise).rejects.toMatchObject({
      name: "ImageTurboError",
      code: "upload-failed",
      message: expect.stringContaining("403"),
    });
  });

  it("rejects network errors and timeouts with upload-failed", async () => {
    const first = startUpload();
    first.xhr!.failNetwork();
    await expect(first.promise).rejects.toMatchObject({ code: "upload-failed" });

    const second = startUpload({ timeoutMs: 5000 });
    second.xhr!.fireTimeout();
    await expect(second.promise).rejects.toMatchObject({
      code: "upload-failed",
      message: expect.stringContaining("5000"),
    });
  });

  it("aborting the signal calls xhr.abort() and rejects with aborted", async () => {
    const { promise, xhr, controller } = startUpload();

    controller.abort();

    expect(xhr?.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
  });

  it("rejects immediately without opening a request when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File([new Uint8Array(10)], "a.webp", { type: "image/webp" });

    await expect(
      uploadToPresignedUrl("https://x", file, { signal: controller.signal, onProgress: vi.fn() }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(MockXHR.instances).toHaveLength(0);
  });

  it("detaches from the signal after completion so a later abort cannot touch the xhr", async () => {
    const { promise, xhr, controller } = startUpload();

    xhr!.respond(200);
    await promise;

    controller.abort();
    expect(xhr?.aborted).toBe(false);
  });
});
