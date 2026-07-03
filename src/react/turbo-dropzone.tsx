"use client";

import type { CSSProperties, MouseEvent, ReactElement } from "react";
import type { CompressStats } from "../core/compressor";
import { useImageTurbo, type UseImageTurboOptions } from "./use-image-turbo";

export interface TurboDropzoneProps<TResult = unknown> extends UseImageTurboOptions<TResult> {
  className?: string;
  style?: CSSProperties;
  /** Main call-to-action line. */
  label?: string;
  /** Secondary helper line under the label. */
  description?: string;
  /** Show the "4.2 MB → 310 KB (95% smaller)" line after compression. Default true. */
  showStats?: boolean;
}

/**
 * The ready-made minimalist dropzone, built entirely on useImageTurbo.
 * Styling comes from `image-turbo/styles.css`; every color is a CSS custom
 * property (`--it-*`) scoped to `.it-dropzone`, so themes are a variable override away.
 */
export function TurboDropzone<TResult = unknown>(props: TurboDropzoneProps<TResult>): ReactElement {
  const {
    className,
    style,
    label = "Drop an image or click to browse",
    description,
    showStats = true,
    ...hookOptions
  } = props;

  const {
    getRootProps,
    getInputProps,
    status,
    isDragActive,
    progress,
    previewUrl,
    stats,
    error,
    reset,
  } = useImageTurbo<TResult>(hookOptions);

  const busy = status === "compressing" || status === "uploading";
  const showPreview = previewUrl !== null && (busy || status === "success");

  const handleReset = (event: MouseEvent) => {
    event.stopPropagation(); // don't let the click reach the root and reopen the picker
    reset();
  };

  const liveMessage =
    status === "compressing"
      ? "Compressing image…"
      : status === "uploading"
        ? "Uploading image…"
        : status === "success"
          ? "Image ready."
          : status === "error" && error
            ? error.message
            : "";

  return (
    <div
      {...getRootProps({ className: cx("it-dropzone", className), style })}
      data-status={status}
      data-drag-active={isDragActive || undefined}
    >
      <input {...getInputProps()} />

      {showPreview ? (
        <>
          <img className="it-preview" src={previewUrl} alt="" />
          {busy && (
            <div
              className="it-progress"
              data-indeterminate={status === "compressing" || undefined}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={status === "uploading" ? Math.round(progress) : undefined}
            >
              <div
                className="it-progress-bar"
                style={status === "uploading" ? { width: `${progress}%` } : undefined}
              />
            </div>
          )}
          {status === "success" && (
            <div className="it-footer">
              {showStats && stats ? <span className="it-stats">{formatStats(stats)}</span> : <span />}
              <button type="button" className="it-reset" aria-label="Remove image" onClick={handleReset}>
                <XIcon />
              </button>
            </div>
          )}
        </>
      ) : status === "error" && error ? (
        <div className="it-content">
          <p className="it-error">{error.message}</p>
          <p className="it-description">Click or drop a file to try again</p>
        </div>
      ) : (
        <div className="it-content">
          <UploadIcon />
          <p className="it-label">{label}</p>
          {description ? <p className="it-description">{description}</p> : null}
        </div>
      )}

      <span className="it-sr-only" role="status" aria-live="polite">
        {liveMessage}
      </span>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${round1(bytes / 1024)} KB`;
  return `${round1(bytes / (1024 * 1024))} MB`;
}

function formatStats(stats: CompressStats): string {
  if (stats.skipped) {
    return `${formatBytes(stats.originalBytes)} · already optimized`;
  }
  const saved = Math.max(0, Math.round((1 - stats.ratio) * 100));
  return `${formatBytes(stats.originalBytes)} → ${formatBytes(stats.compressedBytes)} (${saved}% smaller)`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function cx(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function UploadIcon(): ReactElement {
  return (
    <svg
      className="it-icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      <path d="M12 15V4" />
      <path d="M7 9l5-5 5 5" />
    </svg>
  );
}

function XIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
