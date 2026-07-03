import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", adapters: "src/adapters/index.ts" },
  format: ["esm", "cjs"],
  // Next.js App Router: the bundle contains the hook/component, so the whole
  // chunk is a client module. Harmless no-op string outside RSC environments.
  // NOTE: keep tsup's `treeshake` (rollup pass) off — it strips this banner.
  banner: { js: '"use client";' },
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
});
