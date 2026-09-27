import { Sensitive } from "@/components/sensitive";
import { formatMoney } from "@/lib/money";
import { GRADES } from "@/lib/treasury";

/** Square-holed copper coin (铜钱, "qián") — the app's emblem. */
export function CoinEmblem({ size = 40, hole = "var(--lacquer)", label }: { size?: number; hole?: string; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="10.5" fill="#d4a84b" stroke="#7a5a10" strokeWidth="1" />
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="#7a5a10" strokeWidth="0.6" />
      <rect x="9" y="9" width="6" height="6" fill={hole} stroke="#7a5a10" strokeWidth="0.8" />
    </svg>
  );
}

/** Boat-shaped gold ingot (元宝). */
export function Ingot({ width = 110 }: { width?: number }) {
  return (
    <svg width={width} height={(width * 36) / 60} viewBox="0 0 60 36" aria-hidden="true">
      <path d="M4 16 Q2 8 12 10 L48 10 Q58 8 56 16 Q52 30 30 31 Q8 30 4 16 Z" fill="#e0b646" stroke="#7a5a10" strokeWidth="1.2" />
      <ellipse cx="30" cy="12" rx="12" ry="7" fill="#f3d27a" stroke="#7a5a10" strokeWidth="1.2" />
      <path d="M10 18 Q30 26 50 18" fill="none" stroke="#fff3c4" strokeWidth="1.4" opacity="0.8" />
    </svg>
  );
}

/** Red seal stamp, e.g. on accounts filled from an imported statement. */
export function Seal({ title, char = "钱", className = "" }: { title: string; char?: string; className?: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className={`brush inline-flex h-9 w-9 shrink-0 rotate-6 items-center justify-center rounded bg-[#c0392b] text-xl leading-none text-[#fff3e0] shadow ${className}`}
    >
      {char}
    </span>
  );
}

/** Ten coins filling toward the next milestone. */
export function MilestoneCoins({ progress, target, remaining, currency }: { progress: number; target: number; remaining: number; currency: string }) {
  const filled = Math.max(0, Math.min(10, Math.floor(progress * 10)));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-lacquer">Next milestone</span>
        <Sensitive>
          <span className="text-muted">{formatMoney(target, currency)}</span>
        </Sensitive>
      </div>
      <div
        role="progressbar"
        aria-label="Progress to the next milestone"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={filled}
        className="mt-2 flex gap-1"
      >
        {Array.from({ length: 10 }, (_, i) => (
          <svg key={i} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="shrink">
            <circle cx="12" cy="12" r="10" fill={i < filled ? "#e0b646" : "#e9dfc8"} stroke="#7a5a10" strokeWidth="1" />
            <rect x="9" y="9" width="6" height="6" fill="#faf4e6" stroke="#7a5a10" strokeWidth="0.8" />
          </svg>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">
        <Sensitive>{formatMoney(remaining, currency)}</Sensitive> to go
      </p>
    </div>
  );
}

export function GradeLegend() {
  return (
    <div>
      <p className="mb-2 text-xs tracking-widest text-muted uppercase">Share of assets</p>
      <ul className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-sm">
        {GRADES.map((g) => (
          <li key={g.zh} className="contents">
            <span className="h-3.5 w-3.5 rounded-full border border-[#b8b3a0]" style={{ background: g.color }} />
            <span>{g.label}</span>
            <span className="brush text-lacquer">{g.zh}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FACES = {
  coin: "radial-gradient(circle at 35% 30%, #fff6d0, #e0b646 60%, #a07a1c)",
  paper: "linear-gradient(160deg, #fbf5e6, #e6d6b0)",
  jade: "radial-gradient(circle at 35% 30%, #d8f0e0, #5fae84 55%, #1f5e40)",
  land: "linear-gradient(170deg, #fbf5e6 0%, #cfe1d0 55%, #7f9f8a 100%)",
  seal: "linear-gradient(160deg, #fbf5e6, #f0c9b8)",
  ink: "linear-gradient(160deg, #e9e4da, #a9a39a)",
} as const;
export type Face = keyof typeof FACES;

/** Face for an account, by its category name. */
export function faceForCategory(name: string, kind: "asset" | "debt"): Face {
  if (kind === "debt") return "ink";
  if (/cash/i.test(name)) return "coin";
  if (/crypto/i.test(name)) return "jade";
  if (/real estate|property/i.test(name)) return "land";
  if (/equity|private/i.test(name)) return "seal";
  return "paper";
}

/** A holding or account tile: face by kind, border by share of assets. */
export function Tile({ label, face, gradeColor, size = 48 }: { label: string; face: Face; gradeColor: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md px-0.5 text-center leading-tight font-bold text-ink ${
        label.length > 4 ? "text-[10px]" : "text-xs"
      }`}
      style={{ width: size, height: size, background: FACES[face], border: `3px solid ${gradeColor}`, boxShadow: "inset 0 0 6px rgba(0,0,0,0.25)" }}
    >
      {label}
    </span>
  );
}
