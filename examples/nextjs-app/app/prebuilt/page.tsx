"use client";

import Link from "next/link";
import { useState } from "react";
import { TurboDropzone, type UploadFn } from "image-turbo";
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

export default function PrebuiltDemo() {
  const [uploadedKey, setUploadedKey] = useState<string | null>(null);

  return (
    <main className="demo">
      <nav className="demo-nav">
        <Link href="/">← All examples</Link>
      </nav>
      <h1>Pre-built: &lt;TurboDropzone /&gt;</h1>
      <p className="lede">
        Heavy JPEGs in, lightweight WebP out — resized and re-encoded in your browser,
        then PUT straight to the (mock) bucket via a pre-signed URL.
      </p>

      <TurboDropzone<UploadResult>
        maxWidth={1920}
        maxHeight={1920}
        quality={0.8}
        maxSize={50 * 1024 * 1024}
        upload={upload}
        description="Any image up to 50MB — converted to WebP client-side"
        onSuccess={(result) => setUploadedKey(result?.key ?? null)}
        onError={() => setUploadedKey(null)}
      />

      {uploadedKey ? (
        <p className="result-line" data-testid="uploaded-key">
          Stored as <code>{uploadedKey}</code>
        </p>
      ) : null}
    </main>
  );
}
