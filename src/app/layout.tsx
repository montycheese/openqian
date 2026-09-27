import type { Metadata, Viewport } from "next";
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
    <html lang="en" className="h-full antialiased" data-private={privateMode ? "" : undefined} suppressHydrationWarning>
      <body className="min-h-full">
        <PrivacyProvider initial={privateMode}>
          <header className="lacquer mx-2 mt-2 rounded-md sm:mx-4 sm:mt-4">
            <div className="mx-auto flex max-w-6xl items-center gap-x-1 px-2 py-1.5 text-sm sm:px-3">
              <Link href="/" className="mr-auto flex items-center gap-2.5 px-1 py-1">
                <CoinEmblem size={38} />
                <span className="leading-tight">
                  <span className="block text-lg font-bold text-gold-light">OpenQian</span>
                  <span className="brush block text-sm text-[#f3d27a]">金库</span>
                </span>
              </Link>
              <nav aria-label="Main" className="hidden items-center gap-x-1 sm:flex">
                {NAV.map(([href, label]) => (
                  <Link key={href} href={href} className="rounded px-2 py-2 text-[#e7c9a0] hover:text-gold-light">
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
