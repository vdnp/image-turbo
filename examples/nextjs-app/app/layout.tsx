import type { Metadata } from "next";
import type { ReactNode } from "react";
import "image-turbo/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "image-turbo examples",
  description: "Client-side WebP compression with headless React upload primitives",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
