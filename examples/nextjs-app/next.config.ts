import type { NextConfig } from "next";

// image-turbo arrives via a `file:../..` symlink. No react dedup config is needed:
// with the App Router, Next.js itself aliases `react`/`react-dom` to its vendored
// copies for every module in the graph — including symlinked packages — so a single
// React instance is guaranteed. (Do NOT add a manual `react` webpack alias here; it
// overrides Next's own aliasing and breaks rendering with "Invalid hook call".)
const nextConfig: NextConfig = {};

export default nextConfig;
