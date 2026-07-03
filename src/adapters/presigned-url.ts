import { ImageTurboError } from "../core/errors";
import type { UploadContext } from "../react/use-image-turbo";

export interface PresignedUrlOptions {
  /** HTTP method. S3, R2 and Vercel Blob client uploads are all PUT. Default "PUT". */
  method?: "PUT" | "POST";
  /** Extra request headers. A user-provided Content-Type wins over the file's type. */
  headers?: Record<string, string>;
  withCredentials?: boolean;
  /** Abort the request if it takes longer than this many milliseconds. */
  timeoutMs?: number;
}

export interface PresignedUploadResult {
  status: number;
  /** The ETag response header when the provider exposes it (S3/R2 do for single PUTs). */
  etag: string | null;
}

/**
 * Generic direct-to-cloud upload: PUT the file to a pre-signed URL.
 *
 * Uses XMLHttpRequest rather than fetch because fetch cannot report *upload*
 * progress. Wire it into useImageTurbo like:
 *
 *   upload: async (file, ctx) => {
 *     const { url, key } = await fetch("/api/presign", { method: "POST" }).then(r => r.json());
 *     await uploadToPresignedUrl(url, file, ctx);
 *     return { key };
 *   }
 */
export function uploadToPresignedUrl(
  url: string,
  file: File | Blob,
  context: UploadContext,
  options: PresignedUrlOptions = {},
): Promise<PresignedUploadResult> {
  const { method = "PUT", headers = {}, withCredentials = false, timeoutMs } = options;
  const { signal, onProgress } = context;

  return new Promise<PresignedUploadResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ImageTurboError("aborted", "The upload was aborted before it started."));
      return;
    }

    const xhr = new XMLHttpRequest();

    const onSignalAbort = () => xhr.abort();
    signal.addEventListener("abort", onSignalAbort, { once: true });
    const detach = () => signal.removeEventListener("abort", onSignalAbort);

    xhr.open(method, url, true);
    xhr.withCredentials = withCredentials;
    if (timeoutMs !== undefined) xhr.timeout = timeoutMs;

    const hasUserContentType = Object.keys(headers).some(
      (name) => name.toLowerCase() === "content-type",
    );
    if (!hasUserContentType && file.type) {
      xhr.setRequestHeader("Content-Type", file.type);
    }
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      detach();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve({ status: xhr.status, etag: xhr.getResponseHeader("ETag") });
      } else {
        reject(
          new ImageTurboError("upload-failed", `The server responded with status ${xhr.status}.`),
        );
      }
    };
    xhr.onerror = () => {
      detach();
      reject(new ImageTurboError("upload-failed", "A network error interrupted the upload."));
    };
    xhr.ontimeout = () => {
      detach();
      reject(new ImageTurboError("upload-failed", `The upload timed out after ${timeoutMs}ms.`));
    };
    xhr.onabort = () => {
      detach();
      reject(new ImageTurboError("aborted", "The upload was aborted."));
    };

    xhr.send(file);
  });
}
