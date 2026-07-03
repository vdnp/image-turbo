# image-turbo

**Blazing-fast client-side image compression for React & Next.js.** Turn heavy 10MB JPEGs
into lightweight WebP files *in the browser* — before a single byte leaves the user's
machine — then send them straight to S3, Cloudflare R2 or Vercel Blob via pre-signed URLs.

[![CI](https://github.com/vdnp/image-turbo/actions/workflows/ci.yml/badge.svg)](https://github.com/vdnp/image-turbo/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/image-turbo)](https://www.npmjs.com/package/image-turbo)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

```
3.4 MB JPEG  ──►  632 KB WebP   (82% smaller — measured on the wire in the E2E suite)
```

- ⚡ **Zero dependencies.** Pure Canvas/Web APIs — `createImageBitmap` + `OffscreenCanvas`.
  No WASM blobs, no C++ compiles, ~22KB unminified.
- ☁️ **Direct-to-cloud.** Uploads are an injected `async` function. Massive files PUT
  straight to your bucket via pre-signed URLs and bypass your Next.js API routes entirely.
- 🪝 **Headless-first.** `useImageTurbo()` gives you the full pipeline with zero UI
  opinions; `<TurboDropzone />` is a minimalist, shadcn-adjacent component on top of it.
- 👁️ **Optimistic previews.** A local `blob:` URL appears the instant a file is dropped,
  while compression and upload run in the background.
- 🚦 **Impossible states are unrepresentable.** An explicit status machine
  (`idle → compressing → uploading → success | error`), monotonic progress, and
  `AbortSignal` threaded through every step.
- 🧊 **Next.js App Router & React 19 ready.** SSR-safe (no browser APIs at module scope),
  `"use client"` baked into the bundle, Strict Mode double-mount safe.

---

## Installation

```bash
npm install image-turbo
```

React ≥ 18 is the only peer dependency.

## Quick start — `<TurboDropzone />`

```tsx
"use client";

import { TurboDropzone } from "image-turbo";
import { uploadToPresignedUrl } from "image-turbo/adapters";
import "image-turbo/styles.css"; // once, e.g. in app/layout.tsx

export function AvatarUploader() {
  return (
    <TurboDropzone
      maxWidth={1920}
      maxHeight={1920}
      quality={0.8}
      maxSize={20 * 1024 * 1024}
      description="PNG or JPG up to 20MB — compressed to WebP in your browser"
      upload={async (file, ctx) => {
        // 1. ask your server to sign an upload (tiny JSON round-trip)
        const { url, key } = await fetch("/api/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, type: file.type }),
          signal: ctx.signal,
        }).then((r) => r.json());

        // 2. PUT the compressed WebP straight to the bucket — with real progress
        await uploadToPresignedUrl(url, file, ctx);
        return { key };
      }}
      onSuccess={({ key }) => console.log("stored as", key)}
    />
  );
}
```

That's the entire integration: drop a 10MB photo, watch it preview instantly, compress to
WebP, and upload with a live progress bar — your API routes never touch the pixels.

## Headless — `useImageTurbo()`

Build any UI you want on the same pipeline. The hook exposes prop getters
(react-dropzone style), the state machine, and full pipeline control:

```tsx
"use client";

import { useImageTurbo } from "image-turbo";

export function CustomUploader() {
  const {
    getRootProps,     // spread on your dropzone element (drag/drop/click/keyboard)
    getInputProps,    // spread on a hidden <input type="file" />
    status,           // "idle" | "compressing" | "uploading" | "success" | "error"
    isDragActive,
    isCompressing,
    isUploading,
    progress,         // 0–100 across both phases
    previewUrl,       // optimistic blob: URL, managed & revoked for you
    file,             // the compressed WebP File
    originalFile,
    stats,            // { originalBytes, compressedBytes, ratio, width, height, durationMs, ... }
    result,           // whatever your upload fn returned
    error,            // ImageTurboError | null
    open,             // open the file picker programmatically
    abort,            // cancel in-flight work, keep the compressed file
    reset,            // abort + revoke preview + back to idle
  } = useImageTurbo({
    maxWidth: 1920,
    quality: 0.8,
    upload: myUploadFn, // omit for compression-only mode
  });

  return (
    <div {...getRootProps()} data-active={isDragActive}>
      <input {...getInputProps()} />
      {previewUrl ? <img src={previewUrl} alt="" /> : <p>Drop an image</p>}
      {isCompressing && <p>Compressing…</p>}
      {isUploading && <progress value={progress} max={100} />}
      {status === "success" && stats && (
        <p>{Math.round((1 - stats.ratio) * 100)}% smaller 🎉</p>
      )}
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}
```

## The Direct-to-Cloud architecture

`upload` is a function you inject — the library has no idea (and doesn't care) which cloud
you use. Your server only signs; the browser ships the bytes:

```
 browser                          your server              bucket (S3 / R2 / Blob)
 ───────                          ───────────              ───────────────────────
 drop 10MB JPEG
 compress → 600KB WebP
 POST /api/presign  ────────────► sign key + URL
                    ◄──────────── { url, key }
 PUT 600KB WebP  ═══════════════════════════════════════► stored ✔
```

Your pre-sign route is ~10 lines with any provider:

```ts
// app/api/presign/route.ts  (S3 / R2 — they share the same SDK)
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export async function POST(request: Request) {
  const { name, type } = await request.json();
  const key = `uploads/${crypto.randomUUID()}-${name}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: process.env.BUCKET, Key: key, ContentType: type }),
    { expiresIn: 60 },
  );
  return Response.json({ url, key });
}
```

`uploadToPresignedUrl(url, file, ctx, options?)` handles the rest: an XHR PUT (fetch can't
report *upload* progress), fraction-accurate `onProgress`, `AbortSignal` → `xhr.abort()`
wiring, optional `headers` / `withCredentials` / `timeoutMs`, and it resolves
`{ status, etag }`.

## API reference

### `useImageTurbo<TResult>(options)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxWidth` / `maxHeight` | `number` | — | Contain-fit bounds in px. Never upscales. |
| `quality` | `number` | `0.8` | Encoder quality in `(0, 1]`. |
| `outputType` | `"image/webp" \| "image/jpeg" \| "image/png"` | `"image/webp"` | Auto-falls back to JPEG where WebP encoding is unsupported. |
| `skipCompressionUnder` | `number` | `0` | Files smaller than this (bytes) pass through untouched — no decode at all. |
| `accept` | `Record<string, string[]>` | `{ "image/*": [] }` | Mime patterns → extensions, react-dropzone style. |
| `maxSize` | `number` | — | Max input size in bytes, validated before compression. |
| `disabled` | `boolean` | `false` | Ignore drops, drags and picker opens. |
| `compressionWeight` | `number` | `30` | Share of the progress bar for the compression phase when uploading. |
| `upload` | `(file, { signal, onProgress }) => Promise<TResult>` | — | The direct-to-cloud seam. Omit for compression-only mode. |
| `onDrop` / `onCompressed` / `onSuccess` / `onError` | callbacks | — | Lifecycle hooks (`onCompressed` receives the stats object). |

Returns `getRootProps`, `getInputProps`, `open`, `abort`, `reset`, plus the full state:
`status`, `isDragActive`, `isCompressing`, `isUploading`, `progress`, `previewUrl`,
`originalFile`, `file`, `stats`, `result`, `error`.

### `<TurboDropzone />`

Every hook option above, plus: `className`, `style`, `label`, `description`, and
`showStats` (the `4.2 MB → 310 KB (93% smaller)` line, default `true`).

### `compressImage(file, options)` — framework-free core

```ts
import { compressImage } from "image-turbo";

const { file: webp, stats } = await compressImage(original, {
  maxWidth: 1920,
  quality: 0.8,
  signal: controller.signal,
});
```

Safety valves built in: EXIF orientation is applied during decode, JPEG output gets a
white matte (JPEG has no alpha), and if the "compressed" output would be *larger* than
the input, the original file is returned untouched (`stats.skipped === true`).

### Error handling

Every failure is an `ImageTurboError` with a stable `code`:

| Code | Meaning |
| --- | --- |
| `file-too-large` | Input exceeds `maxSize`. |
| `invalid-type` | Input doesn't match `accept`. |
| `compression-failed` | Decode or encode failed (original error in `cause`). |
| `upload-failed` | Your upload fn threw / non-2xx / network error / timeout. |
| `aborted` | Cancelled — never surfaces as an error state in the hook. |

## Theming

The dropzone is styled exclusively through CSS custom properties scoped to
`.it-dropzone` — no Tailwind requirement, no CSS-in-JS runtime. Dark mode is a
variable override:

```css
.dark .it-dropzone {
  --it-border: #3f3f46;
  --it-border-active: #a1a1aa;
  --it-fg: #fafafa;
  --it-muted: #a1a1aa;
  --it-bg-active: rgba(255, 255, 255, 0.04);
  --it-accent: #fafafa;
}
```

Available variables: `--it-bg`, `--it-bg-active`, `--it-border`, `--it-border-active`,
`--it-fg`, `--it-muted`, `--it-danger`, `--it-accent`, `--it-radius`. State hooks for
deeper customization: `data-status="idle | compressing | uploading | success | error"`
and `data-drag-active` on the root.

## Next.js notes

- The bundle ships with a `"use client"` banner — import the hook or component directly
  in App Router client components, no wrapper needed.
- Nothing touches a browser API at module scope, so importing from shared files that
  also run on the server is safe.
- The `/examples/nextjs-app` directory contains a complete Next.js 15 + React 19 demo of
  both integration styles with a mock pre-signed upload flow: `npm install && npm run dev`
  inside it (build the library first with `npm run build` at the repo root).

## Development

```bash
npm install
npm test          # 84 unit tests against a mocked Canvas environment
npm run e2e       # Playwright: real Chromium, real compression, asserted on the wire
npm run build     # ESM + CJS + d.ts via tsup, plus styles.css
```

The E2E suite generates a multi-megabyte JPEG inside the browser, drops it on both demos,
asserts the UI walks through `compressing → uploading → success`, and verifies that the
payload reaching the mock bucket is `image/webp` at a fraction of the original bytes.

## License

[MIT](./LICENSE) © [Yiğit Enes Kaya](https://github.com/vdnp)
