import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenChieng",
  description: "Local, view-only net worth and portfolio tracker",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full">
        <header className="border-b border-border bg-surface">
          <nav className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 text-sm sm:gap-4">
            <Link href="/" className="mr-auto text-base font-semibold">
              OpenChieng
            </Link>
            <Link href="/accounts/new" className="text-muted hover:text-foreground">
              Add
            </Link>
            <Link href="/import" className="text-muted hover:text-foreground">
              Import
            </Link>
            <Link href="/connections" className="text-muted hover:text-foreground">
              Connections
            </Link>
            <Link href="/settings" className="text-muted hover:text-foreground">
              Settings
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
