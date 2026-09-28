import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SolanaWalletProvider } from "@/components/providers/wallet-provider";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { CookieConsent } from "@/components/analytics/cookie-consent";

const inter = Inter({ subsets: ["latin"] });

const baseUrl = "https://app.bitxbit.com.au";
const ogImage = `${baseUrl}/images/og-image.png`;

export const metadata: Metadata = {
  title: {
    default: "bitXbit Dashboard",
    template: "%s — bitXbit Dashboard",
  },
  description: "Community referral ecosystem dashboard",
  metadataBase: new URL(baseUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "bitXbit Dashboard",
    description: "Community referral ecosystem dashboard",
    url: baseUrl,
    siteName: "bitXbit",
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: "bitXbit Dashboard",
      },
    ],
    locale: "en_AU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "bitXbit Dashboard",
    description: "Community referral ecosystem dashboard",
    images: [ogImage],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "bitXbit",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A0E1A",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <SolanaWalletProvider>
          {children}
          <RegisterServiceWorker />
          <CookieConsent />
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
