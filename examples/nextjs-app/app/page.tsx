import Link from "next/link";

export default function Home() {
  return (
    <main className="demo">
      <h1>image-turbo examples</h1>
      <p className="lede">
        Client-side image compression to WebP with a headless React hook, direct-to-cloud
        uploads and a minimalist dropzone. Both demos below upload to a mock in-app
        &quot;bucket&quot; via a pre-signed-URL flow.
      </p>
      <ul className="demo-list">
        <li>
          <Link href="/prebuilt">
            <strong>&lt;TurboDropzone /&gt;</strong>
            <span>The pre-built minimalist dropzone — one component, zero wiring.</span>
          </Link>
        </li>
        <li>
          <Link href="/headless">
            <strong>useImageTurbo()</strong>
            <span>A fully custom avatar-style UI built on the headless hook alone.</span>
          </Link>
        </li>
      </ul>
    </main>
  );
}
