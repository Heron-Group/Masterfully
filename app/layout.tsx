import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import { InlineScript } from "@/components/inline-script";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: { default: "Masterfully", template: "%s · Masterfully" },
  description: "Research journal, notes and reading list",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Masterfully", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Lets the composer sit above the on-screen keyboard on mobile.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#161513" },
  ],
};

// Runs before first paint so the page never flashes the wrong theme, and
// follows the system's light/dark setting while "Match system" is chosen
// (Settings → Appearance stores a fixed choice in localStorage "theme").
const themeScript = `(function(){function a(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}}a();try{matchMedia("(prefers-color-scheme: dark)").addEventListener("change",a)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-GB"
      data-theme="light"
      suppressHydrationWarning
      className={`${newsreader.variable} ${inter.variable} h-full antialiased`}
    >
      <head>
        <InlineScript html={themeScript} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
