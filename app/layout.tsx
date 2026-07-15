import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;
  return {
    title: "Shed",
    description: "Good care shows. A shared household dashboard for animal husbandry.",
    icons: { icon: "/favicon.svg" },
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
