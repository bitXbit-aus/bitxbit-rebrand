import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SolanaWalletProvider } from "@/components/providers/wallet-provider";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "bitXbit Dashboard",
  description: "Community referral ecosystem dashboard",
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
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
