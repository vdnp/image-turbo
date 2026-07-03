/**
 * Mock storage bucket: accepts the direct PUT a real S3/R2 pre-signed URL would.
 * It reads the whole body (so request size is realistic in devtools/E2E) and adds a
 * transfer delay before answering, giving the progress UI something to display.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const body = await request.arrayBuffer();

  await sleep(800);

  return new Response(null, {
    status: 200,
    headers: {
      ETag: `"mock-${body.byteLength}"`,
      // server-side ground truth for tests: how many bytes actually arrived
      "x-mock-bytes": String(body.byteLength),
      "x-mock-key": decodeURIComponent(key),
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
