"use client";

import { createContext, useContext, useState } from "react";
import { PRIVATE_COOKIE } from "@/lib/privacy";

const PrivacyContext = createContext<{ enabled: boolean; toggle: () => void }>({ enabled: false, toggle: () => {} });

/** Private mode state, seeded from the cookie the server read, so SSR and hydration agree. */
export function PrivacyProvider({ initial, children }: { initial: boolean; children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(initial);
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    document.documentElement.toggleAttribute("data-private", next);
    document.cookie = `${PRIVATE_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };
  return <PrivacyContext.Provider value={{ enabled, toggle }}>{children}</PrivacyContext.Provider>;
}

export const usePrivateMode = () => useContext(PrivacyContext).enabled;

/** Eye button for the header; the label spells out what it does for screen readers. */
export function PrivacyToggle({ withLabel = false }: { withLabel?: boolean }) {
  const { enabled, toggle } = useContext(PrivacyContext);
  const label = enabled ? "Show balances" : "Hide balances";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={withLabel ? undefined : label}
      title={label}
      className={withLabel ? "btn" : "px-2 py-2 text-[#e7c9a0] hover:text-gold-light"}
    >
      <svg viewBox="0 0 12 12" width="22" height="22" shapeRendering="crispEdges" aria-hidden="true" className="inline-block align-[-5px]">
        <path d="M1 6h1V5h2V4h4v1h2v1h1v1h-1v1H8v1H4V8H2V7H1z" fill="currentColor" />
        <rect x="5" y="5" width="2" height="2" fill="var(--lacquer)" />
        {enabled && <path d="M1 1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-1v-1h-1v-1H9V9H8V8H7V7H6V6H5V5H4V4H3V3H2V2H1z" fill="currentColor" />}
      </svg>
      {withLabel && <span className="ml-2">{enabled ? "Private mode is on — show balances" : "Turn on private mode"}</span>}
    </button>
  );
}
