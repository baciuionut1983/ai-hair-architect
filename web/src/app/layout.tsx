import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { APP_VIEWPORT } from "./viewport-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Hair Architect",
  description: "AI Hair Architect - Next.js migration stage",
};

export const viewport = APP_VIEWPORT;

// Deliberately static: lang/dir here are the pre-auth default (English,
// LTR) for every page, public or authenticated. An earlier version of
// this file read the session cookie here to set them from the account's
// own locale -- but Next.js treats any cookies() read anywhere in a
// layout as making EVERY page under it dynamic, which silently forced
// public, unauthenticated pages (login, register, marketplace, ...) out
// of static generation too. The authenticated shell ((app)/layout.tsx,
// already a client component that resolves the account's locale) sets
// the real lang/dir on <html> itself once it knows the account's
// language -- see its own effect -- accepting a brief flash of the
// default direction on first paint for RTL users rather than that
// app-wide regression.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-US"
      dir="ltr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
