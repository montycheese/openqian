// Runs the production build against a throwaway database filled with a sample
// portfolio, for previews and screenshots. Nothing touches your real data.
//   pnpm build && pnpm demo            → http://127.0.0.1:3000
//   PORT=3100 pnpm demo
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const port = Number(process.env.PORT ?? 3000);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openqian-demo-"));
const base = `http://127.0.0.1:${port}`;
const server = spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, DATA_DIR: dataDir },
  stdio: ["ignore", "inherit", "inherit"],
});
const cleanup = () => {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
};
process.on("SIGINT", () => (cleanup(), process.exit(0)));
process.on("SIGTERM", () => (cleanup(), process.exit(0)));

for (let i = 0; i < 60; i++) {
  try {
    await fetch(base + "/"); // first request creates and migrates the database
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

const db = new Database(path.join(dataDir, "openqian.db"));
const cat = (name) => db.prepare("select id from categories where name = ?").get(name).id;
const today = new Date();
const day = (offset) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const accounts = [
  ["checking", "Checking", "Chase", "Cash", "value", "2210"],
  ["brokerage", "Brokerage", "Charles Schwab", "Investments", "holdings", "4821"],
  ["house", "House", null, "Real Estate", "value", null],
  ["cold", "Cold wallet", "Bitcoin wallet", "Crypto", "holdings", "0wlh"],
  ["hot", "Hot wallet", "EVM wallet", "Crypto", "holdings", "6045"],
  ["startup", "Startup shares", null, "Private Equity", "value", null],
  ["mortgage", "Mortgage", "Wells Fargo", "Mortgages", "value", null],
  ["card", "Credit card", "Chase", "Credit Cards", "value", "9981"],
];
const addAccount = db.prepare(
  "insert into accounts (id, name, institution, category_id, kind, currency, account_mask, source) values (?, ?, ?, ?, ?, 'USD', ?, ?)",
);
for (const [id, name, inst, category, kind, mask] of accounts) {
  addAccount.run(id, name, inst, cat(category), kind, mask, id === "brokerage" || id === "checking" ? "import" : "manual");
}
const addValue = db.prepare("insert into valuations (id, account_id, date, value, currency, quantity, unit_price, note) values (?, ?, ?, ?, 'USD', ?, ?, ?)");
addValue.run("v1", "checking", day(0), 12500, null, null, null);
addValue.run("v2", "house", day(120), 495000, null, null, null);
addValue.run("v3", "house", day(3), 512000, null, null, null);
addValue.run("v4", "startup", day(90), 25000, 10000, 2.5, "Series B price");
addValue.run("v5", "mortgage", day(0), 310000, null, null, null);
addValue.run("v6", "card", day(0), 812, null, null, null);
db.prepare("insert into imports (id, account_id, file_name, as_of, positions, total_value) values ('i1', 'brokerage', 'Positions.csv', ?, 4, 68225)").run(day(1));

const addHolding = db.prepare(
  "insert into holdings (id, account_id, symbol, name, type, quantity, price, market_value, currency, network, price_source) values (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'feed')",
);
addHolding.run("h1", "brokerage", "VTI", "Vanguard Total Stock Market ETF", "etf", 150, 310, 46500, null);
addHolding.run("h2", "brokerage", "SCHD", "Schwab U.S. Dividend Equity ETF", "etf", 300, 28, 8400, null);
addHolding.run("h3", "brokerage", "NVDA", "Nvidia", "stock", 40, 180, 7200, null);
addHolding.run("h4", "brokerage", "GOOGL", "Alphabet Class A", "stock", 25, 245, 6125, null);
addHolding.run("h5", "cold", "BTC", "Bitcoin", "crypto", 0.42, 84500, 35490, "bitcoin");
addHolding.run("h6", "hot", "ETH", "Ether", "crypto", 3.1, 2690, 8339, "base");
addHolding.run("h7", "hot", "ETH", "Ether", "crypto", 1.5, 2690, 4035, "ethereum");
addHolding.run("h8", "hot", "USDC", "USD Coin", "crypto", 1200, 1, 1200, "arbitrum");

// 180 days of gently rising net worth for the history chart.
const addSnapshot = db.prepare("insert into snapshots (id, date, base_currency, assets, debts, net_worth) values (?, ?, 'USD', ?, ?, ?)");
const addSnapshotAccount = db.prepare(
  "insert into snapshot_accounts (snapshot_id, account_id, category_id, native_value, native_currency, base_value, counted) values (?, ?, ?, ?, 'USD', ?, 1)",
);
for (let i = 180; i >= 1; i--) {
  const nw = 360167 - i * 330 + Math.round(Math.sin(i / 9) * 4200);
  addSnapshot.run(`s${i}`, day(i), nw + 310812, 310812, nw);
  const brokerage = 68225 - i * 45 + Math.round(Math.sin(i / 7) * 1500);
  addSnapshotAccount.run(`s${i}`, "brokerage", cat("Investments"), brokerage, brokerage);
}
db.close();

console.log(`\nOpenQian demo running at ${base} (sample data; stop with Ctrl+C)\n`);
