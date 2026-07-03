"use client";

import Link from "next/link";
import { useImageTurbo, type UploadFn } from "image-turbo";
import { uploadToPresignedUrl } from "image-turbo/adapters";

interface UploadResult {
  key: string;
}

const upload: UploadFn<UploadResult> = async (file, ctx) => {
  const presign = (await fetch("/api/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, type: file.type }),
    signal: ctx.signal,
  }).then((res) => res.json())) as { url: string; key: string };

  await uploadToPresignedUrl(presign.url, file, ctx);
  return { key: presign.key };
};

/**
 * Everything below is plain markup + the hook: no library CSS, no TurboDropzone.
 * The same pipeline drives a completely different, avatar-style UI.
 */
export default function HeadlessDemo() {
  const {
    getRootProps,
    getInputProps,
    reset,
    status,
    isDragActive,
    isCompressing,
    isUploading,
    progress,
    previewUrl,
    stats,
    result,
    error,
  } = useImageTurbo<UploadResult>({
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 0.8,
    upload,
  });

  const statusText = isCompressing
    ? "Compressing…"
    : isUploading
      ? `Uploading… ${Math.round(progress)}%`
      : status === "success"
        ? "Done"
        : status === "error"
          ? (error?.message ?? "Something went wrong")
          : "Click or drop an image";

  return (
    <main className="demo">
      <nav className="demo-nav">
        <Link href="/">← All examples</Link>
      </nav>
      <h1>Headless: useImageTurbo()</h1>
      <p className="lede">
        A custom avatar uploader built purely on the hook — same compression pipeline,
        entirely different UI.
      </p>

      <div
        {...getRootProps({ className: "avatar-row" })}
        data-drag-active={isDragActive || undefined}
        data-testid="headless-root"
      >
        <input {...getInputProps()} data-testid="headless-input" />
        <div className="avatar">
          {previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- local blob: URL */
            <img src={previewUrl} alt="" data-testid="headless-preview" />
          ) : (
            <span aria-hidden="true">+</span>
          )}
        </div>
        <div className="meta">
          <p className={status === "error" ? "error-text" : undefined} data-testid="headless-status">
            {statusText}
          </p>
          {isUploading ? (
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
          {status === "success" && stats && !stats.skipped ? (
            <p className="muted" data-testid="headless-stats">
              {(stats.originalBytes / 1024 / 1024).toFixed(1)}MB →{" "}
              {(stats.compressedBytes / 1024).toFixed(0)}KB · {stats.width}×{stats.height} ·{" "}
              {Math.round(stats.durationMs)}ms
            </p>
          ) : null}
          {result ? (
            <p className="muted">
              <code data-testid="headless-result">{result.key}</code>
            </p>
          ) : null}
        </div>
      </div>

      <button type="button" className="ghost" onClick={reset} data-testid="headless-reset">
        Reset
      </button>
    </main>
  );
}
