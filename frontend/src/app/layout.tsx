import type { Metadata } from "next";
import { DM_Sans, Syne } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast-provider";
import { WalletProvider } from "@/components/wallet-provider";
import { AppErrorBoundary } from "@/components/app-error-boundary";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap"
});

export const metadata: Metadata = {
  title: "SplitNaira",
  description: "Royalty splitting for creative collaborators on Stellar."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${syne.variable} antialiased`}>
        <AppErrorBoundary>
          <ToastProvider>
            <WalletProvider>{children}</WalletProvider>
          </ToastProvider>
        </AppErrorBoundary>
      </body>
    </html>
  );
}