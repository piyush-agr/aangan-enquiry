import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aangan Studio · Enquiries",
  description: "Phone enquiry system for Aangan Studio, Pune",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,500..750&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
