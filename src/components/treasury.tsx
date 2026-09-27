import Link from "next/link";
import { Sensitive } from "@/components/sensitive";
import { formatMoney } from "@/lib/money";
import { GRADES } from "@/lib/treasury";

// ——— Pixel sprites ———————————————————————————————————————————————
// 12×12 maps: each character is a palette key ("." is transparent). Runs of the
// same key are merged into one <rect>, and crispEdges keeps them sharp at any
// whole-number scale.

type Palette = Record<string, string>;
type SpriteDef = { rows: string[]; palette: Palette };

const OUT = "#2a1208";

function shape(fn: (x: number, y: number) => string): string[] {
  return Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) => fn(x, y)).join(""));
}

const COIN_ROWS = shape((x, y) => {
  const d = Math.hypot(x - 5.5, y - 5.5);
  const dx = Math.abs(x - 5.5);
  const dy = Math.abs(y - 5.5);
  return d > 6 ? "." : d > 5 ? "o" : dx < 1.5 && dy < 1.5 ? "h" : dx < 2.5 && dy < 2.5 ? "o" : x + y < 9 ? "l" : "g";
});

const GEM_ROWS = shape((x, y) => {
  const d = Math.abs(x - 5.5) + Math.abs(y - 5.5) * 0.9;
  return d > 6 ? "." : d > 5 ? "o" : x < 5 && y < 5 ? "l" : y > 7 ? "d" : "g";
});

export const SPRITES = {
  coin: { rows: COIN_ROWS, palette: { o: OUT, g: "#e0b646", l: "#fff0a0", h: "#7a1616" } },
  emptyCoin: { rows: COIN_ROWS, palette: { o: "#7a5a10", g: "#e9dfc8", l: "#f5eedc", h: "#e7d9b4" } },
  ingot: {
    rows: ["............", "....oooo....", "...ollyyo...", "oo.oyyyyo.oo", "oyoolyyyooyo", "oyyyooooyyyo", "olyyyyyyyyyo", ".oyyyyyyyyo.", ".oyyyyyyydo.", "..oyyyyddo..", "...oooooo...", "............"],
    palette: { o: OUT, y: "#e0b646", l: "#fff0a0", d: "#b8860b" },
  },
  scroll: {
    rows: ["............", ".oooooooooo.", "obbbbbbbbbbo", ".oooooooooo.", ".oppppppppo.", ".opiiiiiipo.", ".oppppppppo.", ".opiiiipppo.", ".oppppppppo.", ".oooooooooo.", "obbbbbbbbbbo", ".oooooooooo."],
    palette: { o: OUT, b: "#a0662a", p: "#f3e6c0", i: "#3a2a1a" },
  },
  house: {
    rows: [".....oo.....", "....orro....", "...orrrro...", "..orrrrrro..", ".orrrrrrrro.", "oooooooooooo", ".owwwwwwwwo.", ".owggwwddwo.", ".owggwwddwo.", ".owwwwwddwo.", ".oooooooooo.", "............"],
    palette: { o: OUT, r: "#b3261e", w: "#f3e6c0", g: "#5fae84", d: "#6b3a1a" },
  },
  deed: {
    rows: [".oooooooooo.", ".oppppppppo.", ".opiiiiiipo.", ".oppppppppo.", ".opiiiiippo.", ".oppppppppo.", ".oppppprrro.", ".opppprrrro.", ".oppppprrro.", ".oppppppppo.", ".oooooooooo.", "............"],
    palette: { o: OUT, p: "#f3e6c0", i: "#3a2a1a", r: "#c0392b" },
  },
  chest: {
    rows: ["............", "............", ".oooooooooo.", ".owwwwwwwwo.", "owwwwwwwwwwo", "oooooggooooo", "owwwwoggwwwo", "owwwwwwwwwwo", "owwwwwwwwwwo", "oooooooooooo", "............", "............"],
    palette: { o: OUT, w: "#8a4a22", g: "#e0b646" },
  },
  lock: {
    rows: ["............", "....oooo....", "...o....o...", "...o....o...", "..oooooooo..", "..osssssso..", "..osssssso..", "..ossooosso.", "..ossooosso.", "..osssssso..", "..oooooooo..", "............"],
    palette: { o: OUT, s: "#9aa0a6" },
  },
} satisfies Record<string, SpriteDef>;
export type SpriteName = keyof typeof SPRITES;

/** Crypto gems take the coin's colour. */
export function gem(color: string, dark: string): SpriteDef {
  return { rows: GEM_ROWS, palette: { o: OUT, g: color, l: "#e6fff0", d: dark } };
}

const GEM_COLORS: [RegExp, string, string][] = [
  [/\b(btc|bitcoin)\b/i, "#f7931a", "#b8660a"],
  [/\b(eth|ether|ethereum|evm|base|arbitrum)\b/i, "#627eea", "#3a4ea8"],
  [/\b(sol|solana|phantom)\b/i, "#14f195", "#0a9a5c"],
  [/\b(usdc|usdt|dai)\b/i, "#2775ca", "#1a4f8a"],
];

/** A gem coloured by whichever chain or coin the text mentions (jade otherwise). */
export function gemFor(text: string): SpriteDef {
  const match = GEM_COLORS.find(([re]) => re.test(text));
  return match ? gem(match[1], match[2]) : gem("#5fae84", "#1f5e40");
}

export function Sprite({ sprite, size, label }: { sprite: SpriteDef; size: number; label?: string }) {
  const rects: { x: number; y: number; w: number; fill: string }[] = [];
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      let w = 1;
      while (x + w < row.length && row[x + w] === row[x]) w++;
      const fill = sprite.palette[row[x]];
      if (fill) rects.push({ x, y, w, fill });
      x += w;
    }
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="shrink-0"
    >
      {rects.map((r) => (
        <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

/** Square-holed copper coin (铜钱, "qián") — the app's emblem. */
export function CoinEmblem({ size = 40, label }: { size?: number; label?: string }) {
  return <Sprite sprite={SPRITES.coin} size={size} label={label} />;
}

/** Gold ingot (元宝). */
export function Ingot({ size = 84 }: { size?: number }) {
  return <Sprite sprite={SPRITES.ingot} size={size} />;
}

/** Red seal stamp, e.g. on accounts filled from an imported statement. */
export function Seal({ title, char = "钱", className = "" }: { title: string; char?: string; className?: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className={`brush inline-flex h-10 w-10 shrink-0 rotate-6 items-center justify-center bg-[#c0392b] text-2xl leading-none text-[#fff3e0] shadow-[0_0_0_2px_#1a0806,3px_3px_0_rgba(0,0,0,0.35)] ${className}`}
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
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-bold whitespace-nowrap text-lacquer">Next milestone</span>
        <span className="num text-sm text-muted">
          <Sensitive>{formatMoney(target, currency)}</Sensitive>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Progress to the next milestone"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={filled}
        className="mt-2 flex gap-0.5"
      >
        {Array.from({ length: 10 }, (_, i) => (
          <Sprite key={i} sprite={i < filled ? SPRITES.coin : SPRITES.emptyCoin} size={24} />
        ))}
      </div>
      <p className="mt-1 text-sm text-muted">
        <span className="num">
          <Sensitive>{formatMoney(remaining, currency)}</Sensitive>
        </span>{" "}
        to go
      </p>
    </div>
  );
}

export function GradeLegend() {
  return (
    <div>
      <p className="num mb-2 text-xs text-muted uppercase">Share of assets</p>
      <ul className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 text-sm">
        {GRADES.map((g) => (
          <li key={g.zh} className="contents">
            <span className="h-3 w-3 shadow-[0_0_0_2px_#1a0806]" style={{ background: g.color }} />
            <span className="whitespace-nowrap">
              {g.name} <span className="brush text-lacquer">{g.zh}</span>
            </span>
            <span className="whitespace-nowrap text-muted">{g.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Sprite for an account, by its category (and name, for crypto colours). */
export function spriteForAccount(categoryName: string, kind: "asset" | "debt", text: string): SpriteDef {
  if (kind === "debt") return SPRITES.lock;
  if (/cash/i.test(categoryName)) return SPRITES.coin;
  if (/crypto/i.test(categoryName)) return gemFor(text);
  if (/real estate|property/i.test(categoryName)) return SPRITES.house;
  if (/equity|private/i.test(categoryName)) return SPRITES.deed;
  if (/retire/i.test(categoryName)) return SPRITES.chest;
  if (/invest|stock|broker/i.test(categoryName)) return SPRITES.scroll;
  return SPRITES.chest;
}

/** An inventory slot: sprite, a stack number in the corner, a name underneath. */
export function Slot({
  href,
  name,
  title,
  sprite,
  stack,
  stackColor,
  gradeColor,
  dimmed,
}: {
  href: string;
  name: string;
  title: string;
  sprite: SpriteDef;
  stack: React.ReactNode;
  stackColor: string;
  gradeColor: string;
  dimmed?: boolean;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={`relative flex h-[118px] min-w-0 flex-col items-center justify-between border-2 bg-[#4a261a] px-1 pt-5 pb-1 hover:bg-[#5c3022] focus-visible:outline-2 focus-visible:outline-gold ${dimmed ? "opacity-55" : ""}`}
      style={{ borderColor: "#1c0a06 #7a4a32 #7a4a32 #1c0a06", boxShadow: `inset 0 0 0 2px ${gradeColor}` }}
    >
      <span className="num absolute top-1 left-1.5 text-xs leading-none" style={{ color: stackColor, textShadow: "1px 1px 0 #000" }}>
        {stack}
      </span>
      <Sprite sprite={sprite} size={36} />
      <span className="line-clamp-3 w-full text-center text-[13px] leading-[1.15] break-words text-[#f1e4c2]">{name}</span>
    </Link>
  );
}
