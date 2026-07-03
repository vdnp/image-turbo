import { describe, expect, it } from "vitest";
import type { CompressStats } from "../src/core/compressor";
import { ImageTurboError } from "../src/core/errors";
import {
  imageTurboReducer,
  initialState,
  type ImageTurboAction,
  type ImageTurboState,
} from "../src/react/reducer";

const file = new File([new Uint8Array(10)], "a.webp", { type: "image/webp" });
const original = new File([new Uint8Array(100)], "a.jpg", { type: "image/jpeg" });

const stats: CompressStats = {
  originalBytes: 100,
  compressedBytes: 10,
  ratio: 0.1,
  durationMs: 5,
  width: 800,
  height: 600,
  outputType: "image/webp",
  skipped: false,
};

function run(state: ImageTurboState, ...actions: ImageTurboAction[]): ImageTurboState {
  return actions.reduce(imageTurboReducer, state);
}

const compressingState = run(initialState, {
  type: "DROP",
  originalFile: original,
  previewUrl: "blob:1",
});

const uploadingState = run(compressingState, {
  type: "COMPRESSED",
  file,
  stats,
  hasUpload: true,
  progressFloor: 30,
});

describe("imageTurboReducer", () => {
  it("toggles drag state", () => {
    const active = run(initialState, { type: "DRAG_ENTER" });
    expect(active.isDragActive).toBe(true);
    expect(run(active, { type: "DRAG_LEAVE" }).isDragActive).toBe(false);
  });

  it("DROP starts a fresh compressing state, clearing stale results and errors", () => {
    const dirty: ImageTurboState = {
      ...initialState,
      status: "error",
      error: new ImageTurboError("upload-failed", "boom"),
      result: { key: "old" },
      file,
      progress: 100,
      isDragActive: true,
    };

    const next = run(dirty, { type: "DROP", originalFile: original, previewUrl: "blob:2" });

    expect(next).toMatchObject({
      status: "compressing",
      originalFile: original,
      previewUrl: "blob:2",
      file: null,
      result: null,
      error: null,
      progress: 0,
      isDragActive: false,
    });
  });

  it("COMPRESSED without an upload completes at 100", () => {
    const next = run(compressingState, {
      type: "COMPRESSED",
      file,
      stats,
      hasUpload: false,
      progressFloor: 30,
    });

    expect(next).toMatchObject({ status: "success", file, stats, progress: 100 });
  });

  it("COMPRESSED with an upload moves to uploading at the progress floor", () => {
    expect(uploadingState).toMatchObject({ status: "uploading", file, progress: 30 });
  });

  it("ignores COMPRESSED outside the compressing status (stale completion)", () => {
    expect(run(initialState, { type: "COMPRESSED", file, stats, hasUpload: true, progressFloor: 30 })).toBe(
      initialState,
    );
  });

  it("UPLOAD_PROGRESS clamps to 100 and never moves backwards", () => {
    const at65 = run(uploadingState, { type: "UPLOAD_PROGRESS", progress: 65 });
    expect(at65.progress).toBe(65);
    expect(run(at65, { type: "UPLOAD_PROGRESS", progress: 40 }).progress).toBe(65);
    expect(run(at65, { type: "UPLOAD_PROGRESS", progress: 250 }).progress).toBe(100);
  });

  it("ignores UPLOAD_PROGRESS and SUCCESS unless uploading", () => {
    expect(run(initialState, { type: "UPLOAD_PROGRESS", progress: 50 })).toBe(initialState);
    expect(run(compressingState, { type: "SUCCESS", result: {} })).toBe(compressingState);
  });

  it("SUCCESS stores the upload result at 100", () => {
    const next = run(uploadingState, { type: "SUCCESS", result: { key: "abc" } });
    expect(next).toMatchObject({ status: "success", result: { key: "abc" }, progress: 100 });
  });

  it("ERROR keeps the preview for retry UIs by default", () => {
    const error = new ImageTurboError("upload-failed", "network down");
    const next = run(uploadingState, { type: "ERROR", error });
    expect(next).toMatchObject({ status: "error", error, previewUrl: "blob:1", file });
  });

  it("ERROR with resetFiles clears all file state (validation failures)", () => {
    const error = new ImageTurboError("file-too-large", "too big");
    const next = run(uploadingState, { type: "ERROR", error, resetFiles: true });
    expect(next).toMatchObject({
      status: "error",
      error,
      previewUrl: null,
      file: null,
      originalFile: null,
      result: null,
    });
  });

  it("ABORT returns to idle keeping files, and is ignored when nothing is in flight", () => {
    const aborted = run(uploadingState, { type: "ABORT" });
    expect(aborted).toMatchObject({ status: "idle", progress: 0, file, previewUrl: "blob:1" });

    expect(run(initialState, { type: "ABORT" })).toBe(initialState);
    const success = run(uploadingState, { type: "SUCCESS", result: {} });
    expect(run(success, { type: "ABORT" })).toBe(success);
  });

  it("RESET restores the initial state", () => {
    expect(run(uploadingState, { type: "RESET" })).toBe(initialState);
  });
});
