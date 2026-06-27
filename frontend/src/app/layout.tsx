import type { Metadata } from "next";
import { DM_Sans, Syne } from "next/font/google";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { ToastProvider } from "@/components/toast-provider";
import { WalletProvider } from "@/components/wallet-provider";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { QueryProvider } from "@/components/query-provider";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SplitNaira",
  description: "Royalty splitting for creative collaborators on Stellar.",
  icons: {
    icon: "/favicon.ico",
    apple: "/logo.svg",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body className={`${dmSans.variable} ${syne.variable} antialiased`}>
        <AppErrorBoundary>
          <QueryProvider>
            <ToastProvider>
              <WalletProvider>{children}</WalletProvider>
            </ToastProvider>
          </QueryProvider>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
