import type { Metadata } from "next";
import "./globals.css";
import DialogAccessibilityManager from "./dialog-accessibility";

// The viewport tag is written by hand in the layout below: this runtime drops
// viewportFit from the metadata export, and we need viewport-fit=cover for the
// safe-area insets that keep the mobile dock off the home indicator.

const projectUrl = "https://animalroom.app/shed/";
const socialImage = "https://animalroom.app/shed/og.png";

// Public social metadata must be canonical and must never reflect an
// untrusted Host/X-Forwarded-Host header from a local reverse proxy request.
export const metadata: Metadata = {
  metadataBase: new URL(projectUrl),
  title: "Shed",
  description: "Good care shows. A shared household dashboard for animal husbandry.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Shed" },
  formatDetection: { telephone: false },
  alternates: { canonical: projectUrl },
  openGraph: { title: "Shed", description: "Good care shows.", type: "website", url: projectUrl, images: [socialImage] },
  twitter: { card: "summary_large_image", title: "Shed", description: "Good care shows.", images: [socialImage] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#21372e" />
        {/* Set the theme before first paint so night mode never flashes light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("shed-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body><DialogAccessibilityManager />{children}</body>
    </html>
  );
}
