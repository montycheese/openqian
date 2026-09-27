import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import Link from "next/link";
import { PrivacyProvider, PrivacyToggle } from "@/components/privacy";
import { NavMenu } from "@/components/nav-menu";
import { CoinEmblem } from "@/components/treasury";
import { PRIVATE_COOKIE } from "@/lib/privacy";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenQian",
  description: "Local, view-only net worth and portfolio tracker",
  icons: { icon: "/icon.svg" },
};

// Bundled pixel fonts (OFL; see src/app/fonts/README.md) — served locally, no font requests.
const pixel = localFont({ src: "./fonts/PixelifySans.woff2", variable: "--font-pixel", weight: "400 700", display: "swap" });
const numbers = localFont({ src: "./fonts/Silkscreen-Regular.woff2", variable: "--font-num", display: "swap" });
const chinese = localFont({ src: "./fonts/ZCOOLQingKeHuangYou-subset.woff2", variable: "--font-cjk", display: "swap" });

const NAV = [
  ["/accounts/new", "Add"],
  ["/import", "Import"],
  ["/connections", "Connections"],
  ["/settings", "Settings"],
] as const;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const privateMode = (await cookies()).get(PRIVATE_COOKIE)?.value === "1";
  return (
    <html lang="en" className={`h-full ${pixel.variable} ${numbers.variable} ${chinese.variable}`} data-private={privateMode ? "" : undefined} suppressHydrationWarning>
      <body className="min-h-full">
        <PrivacyProvider initial={privateMode}>
          <header className="lacquer mx-3 mt-3 sm:mx-5 sm:mt-5">
            <div className="mx-auto flex max-w-6xl items-center gap-x-1 px-2 py-1.5 text-sm sm:px-3">
              <Link href="/" className="mr-auto flex items-center gap-2.5 px-1 py-1">
                <CoinEmblem size={38} />
                <span className="leading-tight">
                  <span className="pixel-shadow block text-xl font-bold text-gold-light">OpenQian</span>
                  <span className="brush pixel-shadow block text-base text-[#f3d27a]">金库</span>
                </span>
              </Link>
              <nav aria-label="Main" className="hidden items-center gap-x-1 sm:flex">
                {NAV.map(([href, label]) => (
                  <Link key={href} href={href} className="pixel-shadow px-2 py-2 text-lg text-[#e7c9a0] hover:text-gold-light">
                    {label}
                  </Link>
                ))}
              </nav>
              <PrivacyToggle />
              <NavMenu links={NAV} />
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-6">{children}</main>
        </PrivacyProvider>
      </body>
    </html>
  );
}
