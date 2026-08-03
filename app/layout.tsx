import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#21372e",
  // Draw into the display cutout and home-indicator areas so the CSS can
  // position the mobile dock with env(safe-area-inset-*) instead of guessing.
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;
  return {
    title: "Shed",
    description: "Good care shows. A shared household dashboard for animal husbandry.",
    manifest: "/manifest.webmanifest",
    icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Shed" },
    formatDetection: { telephone: false },
    openGraph: { title: "Shed", description: "Good care shows.", images: [socialImage] },
    twitter: { card: "summary_large_image", title: "Shed", description: "Good care shows.", images: [socialImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
