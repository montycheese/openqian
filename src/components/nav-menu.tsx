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
        className="flex h-11 w-11 items-center justify-center border-[3px] bg-[#5a0d0d] text-gold-light"
        style={{ borderColor: "#9b2a1c #2a0404 #2a0404 #9b2a1c" }}
      >
        <svg width="22" height="22" viewBox="0 0 12 12" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
          {open ? (
            <path d="M2 2h2v1h1v1h2V3h1V2h2v2H9v1H8v2h1v1h1v2H8V9H7V8H5v1H4v1H2V8h1V7h1V5H3V4H2z" />
          ) : (
            <path d="M2 3h8v1H2zM2 6h8v1H2zM2 9h8v1H2z" />
          )}
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
                  className="block px-3 py-3 text-base text-[#e7c9a0] hover:bg-[#8a1c1c] hover:text-gold-light aria-[current=page]:text-gold-light"
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
