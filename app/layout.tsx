import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

// The viewport tag is written by hand in the layout below: this runtime drops
// viewportFit from the metadata export, and we need viewport-fit=cover for the
// safe-area insets that keep the mobile dock off the home indicator.

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
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#21372e" />
      </head>
      <body>{children}</body>
    </html>
  );
}
