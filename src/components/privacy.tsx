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
      className={withLabel ? "btn" : "rounded-md px-2 py-2 text-muted hover:text-foreground"}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="inline-block align-[-3px]">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        {enabled && <path d="M3 3l18 18" />}
      </svg>
      {withLabel && <span className="ml-2">{enabled ? "Private mode is on — show balances" : "Turn on private mode"}</span>}
    </button>
  );
}
