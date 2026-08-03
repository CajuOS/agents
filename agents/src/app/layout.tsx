import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://agents.cajuos.dev";

export const metadata: Metadata = {
  title: {
    default: "caju-agents",
    template: "%s · caju-agents",
  },
  description:
    "Mídia para agents: API e MCP remoto que extraem áudio e vídeo de qualquer página.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "caju-agents",
    url: siteUrl,
    title: "caju-agents",
    description:
      "Mídia para agents: API e MCP remoto que extraem áudio e vídeo de qualquer página.",
  },
  twitter: {
    card: "summary",
    title: "caju-agents",
    description:
      "Mídia para agents: API e MCP remoto que extraem áudio e vídeo de qualquer página.",
  },
  alternates: {
    canonical: siteUrl,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
