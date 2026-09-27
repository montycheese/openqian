"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

/** Header links as a dropdown on small screens (inline links take over from `sm` up). */
export function NavMenu({ links }: { links: readonly (readonly [string, string])[] }) {
  const pathname = usePathname();
  // The path the menu was opened on; navigating anywhere else closes it.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (value: boolean) => setOpenedAt(value ? pathname : null);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  // Close on Escape and on a tap outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenedAt(null);
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpenedAt(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className="relative sm:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="flex h-11 w-11 items-center justify-center rounded border border-[#b08a3a] text-gold-light"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <nav id={panelId} aria-label="Main" className="lacquer absolute top-full right-0 z-20 mt-2 w-52 p-2">
          <ul>
            {links.map(([href, label]) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={pathname === href ? "page" : undefined}
                  className="block rounded px-3 py-3 text-base text-[#e7c9a0] hover:bg-[#8a1c1c] hover:text-gold-light aria-[current=page]:text-gold-light"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
