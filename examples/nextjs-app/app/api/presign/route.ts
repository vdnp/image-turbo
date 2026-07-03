import { NextResponse } from "next/server";

/**
 * Mock pre-sign endpoint. In production, swap the body for your provider's SDK:
 *
 *   S3 / R2:
 *     const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: type }), { expiresIn: 60 });
 *
 *   Vercel Blob (client uploads):
 *     return handleUpload({ request, onBeforeGenerateToken: ... });
 *
 * Here we just point the client at an in-app route that plays the part of the bucket.
 */
export async function POST(request: Request) {
  const { name, type } = (await request.json()) as { name?: string; type?: string };

  // Simulate the signing round-trip so the demo (and the E2E suite) can observe
  // the "uploading" state rather than it flashing by instantly on localhost.
  await sleep(400);

  const safeName = (name ?? "file").replace(/[^\w.-]+/g, "_");
  const key = `uploads/${Date.now()}-${safeName}`;

  return NextResponse.json({
    url: `/api/mock-bucket/${encodeURIComponent(key)}`,
    key,
    contentType: type ?? "application/octet-stream",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
