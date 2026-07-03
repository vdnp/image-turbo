"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { compressImage, type CompressStats, type OutputType } from "../core/compressor";
import { ImageTurboError, isImageTurboError } from "../core/errors";
import {
  imageTurboReducer,
  initialState,
  type ImageTurboStatus,
} from "./reducer";
import { acceptToInputAttr, DEFAULT_ACCEPT, validateFile, type AcceptMap } from "./validate";

export interface UploadContext {
  signal: AbortSignal;
  /** Report upload progress as a fraction in [0, 1]. */
  onProgress: (fraction: number) => void;
}

/**
 * The direct-to-cloud seam: receives the compressed file plus an abort signal and
 * progress reporter. Fetch a pre-signed URL and PUT to it here — the library never
 * needs to know which provider is behind it.
 */
export type UploadFn<TResult = unknown> = (file: File, context: UploadContext) => Promise<TResult>;

export type DropzoneRootProps = HTMLAttributes<HTMLElement>;
export type DropzoneInputProps = InputHTMLAttributes<HTMLInputElement>;

export interface UseImageTurboOptions<TResult = unknown> {
  maxWidth?: number;
  maxHeight?: number;
  /** Encoder quality in (0, 1]. Default 0.8. */
  quality?: number;
  outputType?: OutputType;
  /** Files smaller than this (bytes) skip compression entirely. */
  skipCompressionUnder?: number;
  /** Accepted types. Default `{ "image/*": [] }`. */
  accept?: AcceptMap;
  /** Maximum input file size in bytes, validated before compression starts. */
  maxSize?: number;
  disabled?: boolean;
  /**
   * Share of the progress bar (0–100) attributed to the compression phase when an
   * upload fn is present. Default 30: compression fills 0–30, the upload 30–100.
   */
  compressionWeight?: number;
  /** Omit for compression-only mode: the pipeline ends at "success" after compression. */
  upload?: UploadFn<TResult>;
  onDrop?: (file: File) => void;
  onCompressed?: (file: File, stats: CompressStats) => void;
  onSuccess?: (result: TResult | undefined, file: File) => void;
  onError?: (error: ImageTurboError) => void;
}

export interface UseImageTurboReturn<TResult = unknown> {
  getRootProps: (props?: DropzoneRootProps) => DropzoneRootProps;
  getInputProps: (
    props?: DropzoneInputProps,
  ) => DropzoneInputProps & { ref: RefObject<HTMLInputElement | null> };
  /** Programmatically opens the file picker. */
  open: () => void;
  /** Aborts in-flight work, revokes the preview URL and returns to idle. */
  reset: () => void;
  /** Cancels in-flight work but keeps the compressed file and preview for a retry. */
  abort: () => void;
  status: ImageTurboStatus;
  isDragActive: boolean;
  isCompressing: boolean;
  isUploading: boolean;
  progress: number;
  previewUrl: string | null;
  originalFile: File | null;
  file: File | null;
  stats: CompressStats | null;
  result: TResult | null;
  error: ImageTurboError | null;
}

const DEFAULT_COMPRESSION_WEIGHT = 30;

export function useImageTurbo<TResult = unknown>(
  options: UseImageTurboOptions<TResult> = {},
): UseImageTurboReturn<TResult> {
  const [state, dispatch] = useReducer(imageTurboReducer, initialState);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const dragDepthRef = useRef(0);

  // Latest-options ref so the pipeline and event handlers stay referentially stable
  // without capturing stale callbacks.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const revokeCurrentPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // Unmount cleanup. Refs (not state) are the source of truth here, so Strict Mode's
  // mount → cleanup → remount cycle is a no-op: at that point no preview or pipeline
  // exists yet, and after a real unmount both are torn down exactly once.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      revokeCurrentPreview();
    };
  }, [revokeCurrentPreview]);

  const runPipeline = useCallback(
    async (input: File) => {
      const opts = optionsRef.current;

      // A new drop owns the pipeline: cancel whatever was in flight.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      const validationError = validateFile(input, opts.accept ?? DEFAULT_ACCEPT, opts.maxSize);
      if (validationError) {
        revokeCurrentPreview();
        dispatch({ type: "ERROR", error: validationError, resetFiles: true });
        opts.onError?.(validationError);
        return;
      }

      // Optimistic preview: synchronous, before any compression work starts.
      revokeCurrentPreview();
      const previewUrl = URL.createObjectURL(input);
      previewUrlRef.current = previewUrl;
      dispatch({ type: "DROP", originalFile: input, previewUrl });
      opts.onDrop?.(input);

      let stage: "compression" | "upload" = "compression";
      try {
        const { file: compressed, stats } = await compressImage(input, {
          maxWidth: opts.maxWidth,
          maxHeight: opts.maxHeight,
          quality: opts.quality,
          outputType: opts.outputType,
          skipCompressionUnder: opts.skipCompressionUnder,
          signal,
        });
        if (signal.aborted) return;
        opts.onCompressed?.(compressed, stats);

        const weight = opts.compressionWeight ?? DEFAULT_COMPRESSION_WEIGHT;
        if (!opts.upload) {
          dispatch({ type: "COMPRESSED", file: compressed, stats, hasUpload: false, progressFloor: weight });
          opts.onSuccess?.(undefined, compressed);
          return;
        }

        dispatch({ type: "COMPRESSED", file: compressed, stats, hasUpload: true, progressFloor: weight });
        stage = "upload";
        const result = await opts.upload(compressed, {
          signal,
          onProgress: (fraction) => {
            const bounded = Math.min(1, Math.max(0, fraction));
            dispatch({ type: "UPLOAD_PROGRESS", progress: weight + bounded * (100 - weight) });
          },
        });
        if (signal.aborted) return;

        dispatch({ type: "SUCCESS", result });
        optionsRef.current.onSuccess?.(result, compressed);
      } catch (thrown) {
        // Aborts are not failures: reset(), abort() or a newer drop already owns the state.
        if (signal.aborted || (isImageTurboError(thrown) && thrown.code === "aborted")) return;

        const error = isImageTurboError(thrown)
          ? thrown
          : new ImageTurboError(
              stage === "upload" ? "upload-failed" : "compression-failed",
              thrown instanceof Error ? thrown.message : `The ${stage} step failed.`,
              { cause: thrown },
            );
        dispatch({ type: "ERROR", error });
        optionsRef.current.onError?.(error);
      }
    },
    [revokeCurrentPreview],
  );

  const open = useCallback(() => {
    if (optionsRef.current.disabled) return;
    inputRef.current?.click();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    revokeCurrentPreview();
    dragDepthRef.current = 0;
    if (inputRef.current) inputRef.current.value = "";
    dispatch({ type: "RESET" });
  }, [revokeCurrentPreview]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "ABORT" });
  }, []);

  // ---- dropzone event handlers (stable: they only touch refs and dispatch) ----

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
    [open],
  );

  const handleDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    if (optionsRef.current.disabled) return;
    // Depth counter: enter/leave also fire for every child element crossed.
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) dispatch({ type: "DRAG_ENTER" });
  }, []);

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault(); // required — without it the browser refuses the drop
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    if (dragDepthRef.current === 0) return;
    dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) dispatch({ type: "DRAG_LEAVE" });
  }, []);

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      dispatch({ type: "DRAG_LEAVE" });
      if (optionsRef.current.disabled) return;
      const file = event.dataTransfer?.files?.[0];
      if (file) void runPipeline(file);
    },
    [runPipeline],
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = ""; // allow re-selecting the same file
      if (file) void runPipeline(file);
    },
    [runPipeline],
  );

  const stopPropagation = useCallback((event: SyntheticEvent) => {
    // open() triggers input.click(); without this the click bubbles back to the
    // root's onClick and opens the picker twice.
    event.stopPropagation();
  }, []);

  const disabled = options.disabled ?? false;
  const acceptAttr = useMemo(() => acceptToInputAttr(options.accept), [options.accept]);

  const getRootProps = useCallback(
    (userProps: DropzoneRootProps = {}): DropzoneRootProps => ({
      ...userProps,
      role: userProps.role ?? "button",
      tabIndex: disabled ? -1 : (userProps.tabIndex ?? 0),
      onClick: composeEventHandlers(userProps.onClick, open),
      onKeyDown: composeEventHandlers(userProps.onKeyDown, handleKeyDown),
      onDragEnter: composeEventHandlers(userProps.onDragEnter, handleDragEnter),
      onDragOver: composeEventHandlers(userProps.onDragOver, handleDragOver),
      onDragLeave: composeEventHandlers(userProps.onDragLeave, handleDragLeave),
      onDrop: composeEventHandlers(userProps.onDrop, handleDrop),
    }),
    [disabled, open, handleKeyDown, handleDragEnter, handleDragOver, handleDragLeave, handleDrop],
  );

  const getInputProps = useCallback(
    (userProps: DropzoneInputProps = {}) => ({
      ...userProps,
      type: "file" as const,
      accept: userProps.accept ?? acceptAttr,
      multiple: false,
      tabIndex: -1,
      disabled,
      style: { display: "none", ...userProps.style } as CSSProperties,
      onChange: composeEventHandlers(userProps.onChange, handleInputChange),
      onClick: composeEventHandlers(userProps.onClick, stopPropagation),
      ref: inputRef,
    }),
    [acceptAttr, disabled, handleInputChange, stopPropagation],
  );

  return useMemo(
    () => ({
      getRootProps,
      getInputProps,
      open,
      reset,
      abort,
      status: state.status,
      isDragActive: state.isDragActive,
      isCompressing: state.status === "compressing",
      isUploading: state.status === "uploading",
      progress: state.progress,
      previewUrl: state.previewUrl,
      originalFile: state.originalFile,
      file: state.file,
      stats: state.stats,
      result: (state.result ?? null) as TResult | null,
      error: state.error,
    }),
    [state, getRootProps, getInputProps, open, reset, abort],
  );
}

function composeEventHandlers<E extends SyntheticEvent>(
  theirs: ((event: E) => void) | undefined,
  ours: (event: E) => void,
): (event: E) => void {
  return (event) => {
    theirs?.(event);
    // consumers opt out of the default behavior by calling event.preventDefault()
    if (!event.defaultPrevented) ours(event);
  };
}
