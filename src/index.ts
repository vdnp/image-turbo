// ---- core (framework-free) ----
export { compressImage, computeTargetSize } from "./core/compressor";
export type {
  CompressOptions,
  CompressResult,
  CompressStats,
  OutputType,
  SkipReason,
} from "./core/compressor";

export { loadImage } from "./core/image-loader";
export type { DecodedImage } from "./core/image-loader";

export {
  canEncodeWebP,
  supportsOffscreenCanvas,
  resetFeatureDetectionCache,
} from "./core/feature-detect";

export { ImageTurboError, isImageTurboError } from "./core/errors";
export type { ImageTurboErrorCode } from "./core/errors";

// ---- react ----
export { useImageTurbo } from "./react/use-image-turbo";
export type {
  DropzoneInputProps,
  DropzoneRootProps,
  UploadContext,
  UploadFn,
  UseImageTurboOptions,
  UseImageTurboReturn,
} from "./react/use-image-turbo";

export { TurboDropzone, formatBytes } from "./react/turbo-dropzone";
export type { TurboDropzoneProps } from "./react/turbo-dropzone";

export { imageTurboReducer, initialState as imageTurboInitialState } from "./react/reducer";
export type { ImageTurboAction, ImageTurboState, ImageTurboStatus } from "./react/reducer";

export { acceptToInputAttr, validateFile, DEFAULT_ACCEPT } from "./react/validate";
export type { AcceptMap } from "./react/validate";
