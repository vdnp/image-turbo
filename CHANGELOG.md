# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-03

### Added

- **Core compression engine** (`compressImage`) — pure Canvas/Web API pipeline: decode via
  `createImageBitmap` with EXIF orientation handling, contain-resize (never upscales),
  re-encode to WebP through `OffscreenCanvas` with an `HTMLCanvasElement` fallback.
  Zero runtime dependencies.
- Automatic JPEG fallback (with white matte for alpha) on browsers that cannot encode WebP.
- Smart pass-through: files under `skipCompressionUnder` skip decoding entirely, and
  outputs that would be *larger* than the input return the original file.
- **Headless hook** (`useImageTurbo`) — prop-getter dropzone API, explicit status state
  machine, optimistic `previewUrl` via `URL.createObjectURL` with strict revocation on
  replace/reset/unmount, `AbortSignal` threading, weighted compression/upload progress,
  and React 18/19 Strict Mode-safe cleanup.
- **`<TurboDropzone />`** — minimalist, shadcn-adjacent prebuilt component themed entirely
  through `--it-*` CSS custom properties (`image-turbo/styles.css`), with indeterminate →
  determinate progress, compression stats line, and `aria-live` status announcements.
- **`uploadToPresignedUrl`** (`image-turbo/adapters`) — generic direct-to-cloud XHR PUT
  with real upload progress, abort wiring, timeout support, and typed errors. Works with
  S3, Cloudflare R2 and Vercel Blob pre-signed URLs.
- Typed error model (`ImageTurboError` with stable `code` values).
- Dual ESM + CJS builds with TypeScript declarations and a verified `"use client"` banner
  for Next.js App Router.
- Example Next.js 15 (App Router, React 19) app demonstrating both the prebuilt component
  and a fully custom headless UI, plus a mock pre-signed upload flow.
- 84 unit tests (mocked Canvas environment) and a Playwright E2E suite that verifies the
  compression on the wire (multi-MB JPEG in, ~80% smaller WebP payload out).

[1.0.0]: https://github.com/vdnp/image-turbo/releases/tag/v1.0.0
