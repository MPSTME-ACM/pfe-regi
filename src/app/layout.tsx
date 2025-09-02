import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Background from "@/components/Background";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PFE - Programming For Everyone",
  description: "For Programmers. By Programmers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script defer src="https://umami.mpst.me/script.js" data-website-id="4bb9baf1-2d2e-42ec-bf9c-7b7a8d0ff8a1"></script>
          <Background />
        {children}
      </body>
    </html>
  );
}
