import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { PrivacyProvider, PrivacyToggle } from "@/components/privacy";
import { PRIVATE_COOKIE } from "@/lib/privacy";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenChieng",
  description: "Local, view-only net worth and portfolio tracker",
};

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
          <header className="border-b border-border bg-surface">
            <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-1 px-2 py-1 text-sm sm:px-4">
              <Link href="/" className="mr-auto px-2 py-2 text-base font-semibold">
                OpenChieng
              </Link>
              <Link href="/accounts/new" className="rounded-md px-2 py-2 text-muted hover:text-foreground">
                Add
              </Link>
              <Link href="/import" className="rounded-md px-2 py-2 text-muted hover:text-foreground">
                Import
              </Link>
              <Link href="/connections" className="rounded-md px-2 py-2 text-muted hover:text-foreground">
                Connections
              </Link>
              <Link href="/settings" className="rounded-md px-2 py-2 text-muted hover:text-foreground">
                Settings
              </Link>
              <PrivacyToggle />
            </nav>
          </header>
          <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
        </PrivacyProvider>
      </body>
    </html>
  );
}
