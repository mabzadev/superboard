import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import UserContextProvider from "@/context/useUserContext";
import { Toaster } from "@/components/ui/sonner";
import { Suspense } from "react";
import { ThemeProvider } from "next-themes";
import { AnalyticsProvider } from "@/analytics/AnalyticsProvider";
import { WebVitals } from "@/analytics/WebVitals";
import QueryProvider from "@/lib/QueryProvider";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Grovs",
    template: "%s | Grovs",
  },
  description:
    "SaaS dashboard for mobile app growth — deep links, messaging campaigns, revenue tracking, and audience analytics.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.grovs.io"
  ),
  openGraph: {
    type: "website",
    siteName: "Grovs",
    title: "Grovs — App Growth. Solved",
    description:
      "Deep links, messaging campaigns, revenue tracking, and audience analytics for mobile apps.",
  },
  robots: {
    index: false,
    follow: false,
  },
};

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="">
      {GTM_ID && (
        <Script
          id="gtm-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
              new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
              'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${GTM_ID}');
            `,
          }}
        />
      )}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        )}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <QueryProvider>
            <Suspense fallback={null}>
              <Toaster />
              <AnalyticsProvider>
                <UserContextProvider>{children}</UserContextProvider>
              </AnalyticsProvider>
            </Suspense>
            <Suspense fallback={null}>
              <WebVitals />
            </Suspense>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
