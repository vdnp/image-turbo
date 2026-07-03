import type { CompressStats } from "../core/compressor";
import type { ImageTurboError } from "../core/errors";

export type ImageTurboStatus = "idle" | "compressing" | "uploading" | "success" | "error";

export interface ImageTurboState {
  status: ImageTurboStatus;
  isDragActive: boolean;
  /** Overall pipeline progress 0–100 across the compression and upload phases. */
  progress: number;
  /** Optimistic local blob: URL for the dropped file. */
  previewUrl: string | null;
  originalFile: File | null;
  /** The compressed output file. */
  file: File | null;
  stats: CompressStats | null;
  result: unknown;
  error: ImageTurboError | null;
}

export const initialState: ImageTurboState = {
  status: "idle",
  isDragActive: false,
  progress: 0,
  previewUrl: null,
  originalFile: null,
  file: null,
  stats: null,
  result: null,
  error: null,
};

export type ImageTurboAction =
  | { type: "DRAG_ENTER" }
  | { type: "DRAG_LEAVE" }
  | { type: "DROP"; originalFile: File; previewUrl: string }
  | {
      type: "COMPRESSED";
      file: File;
      stats: CompressStats;
      hasUpload: boolean;
      /** Overall progress reached once compression is done (the compression phase's weight). */
      progressFloor: number;
    }
  | { type: "UPLOAD_PROGRESS"; progress: number }
  | { type: "SUCCESS"; result: unknown }
  | {
      type: "ERROR";
      error: ImageTurboError;
      /** True for pre-pipeline failures (validation): clears any stale file/preview state. */
      resetFiles?: boolean;
    }
  | { type: "ABORT" }
  | { type: "RESET" };

/**
 * Pure state machine for the upload pipeline. Actions arriving in a status they
 * don't belong to (stale async completions after an abort/reset) are ignored,
 * which is what makes impossible states like `isUploading && error` unrepresentable.
 */
export function imageTurboReducer(state: ImageTurboState, action: ImageTurboAction): ImageTurboState {
  switch (action.type) {
    case "DRAG_ENTER":
      return state.isDragActive ? state : { ...state, isDragActive: true };

    case "DRAG_LEAVE":
      return state.isDragActive ? { ...state, isDragActive: false } : state;

    case "DROP":
      return {
        ...initialState,
        status: "compressing",
        originalFile: action.originalFile,
        previewUrl: action.previewUrl,
      };

    case "COMPRESSED":
      if (state.status !== "compressing") return state;
      return {
        ...state,
        file: action.file,
        stats: action.stats,
        status: action.hasUpload ? "uploading" : "success",
        progress: action.hasUpload ? clamp(action.progressFloor, 0, 100) : 100,
      };

    case "UPLOAD_PROGRESS":
      if (state.status !== "uploading") return state;
      // clamped below by the current value: progress never moves backwards
      return { ...state, progress: clamp(action.progress, state.progress, 100) };

    case "SUCCESS":
      if (state.status !== "uploading") return state;
      return { ...state, status: "success", result: action.result, progress: 100 };

    case "ERROR":
      if (action.resetFiles) {
        return { ...initialState, status: "error", error: action.error };
      }
      return { ...state, status: "error", error: action.error, isDragActive: false };

    case "ABORT":
      // keeps the compressed file and preview around so the UI can offer a retry
      if (state.status !== "compressing" && state.status !== "uploading") return state;
      return { ...state, status: "idle", progress: 0, isDragActive: false };

    case "RESET":
      return initialState;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
