// Starts the production build against a throwaway database, seeds a few
// accounts, and requests every page. Exits non-zero on any failing page.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// Ask the OS for a free port so parallel runs can't collide.
const port = await new Promise((resolve) => {
  const srv = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openqian-smoke-"));
const base = `http://127.0.0.1:${port}`;
const server = spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function get(route, expectText, headers = {}) {
  const res = await fetch(base + route, { headers });
  const body = await res.text();
  const problem =
    res.status !== 200
      ? `HTTP ${res.status}`
      : /Application error|Internal Server Error/.test(body)
        ? "error page"
        : expectText && !body.includes(expectText)
          ? `missing "${expectText}"`
          : null;
  return { route, problem };
}

let failed = false;
try {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + "/");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  // First request creates and migrates the database; then add sample data.
  const empty = await Promise.all(["/", "/settings"].map((r) => get(r)));
  const db = new Database(path.join(dataDir, "openqian.db"));
  const cat = (name) => db.prepare("select id from categories where name = ?").get(name).id;
  const addAccount = db.prepare(
    "insert into accounts (id, name, category_id, kind, currency) values (?, ?, ?, ?, ?)",
  );
  addAccount.run("smoke-value", "Checking", cat("Cash"), "value", "USD");
  addAccount.run("smoke-eur", "Euro savings", cat("Cash"), "value", "EUR");
  addAccount.run("smoke-holdings", "Brokerage", cat("Investments"), "holdings", "USD");
  addAccount.run("smoke-debt", "Card", cat("Credit Cards"), "value", "USD");
  addAccount.run("smoke-wallet", "Hot wallet", cat("Crypto"), "holdings", "USD");
  db.prepare(
    "insert into wallets (id, account_id, family, address, chains) values ('w1', 'smoke-wallet', 'evm', '0x000000000000000000000000000000000000dead', '[\"ethereum\",\"base\"]')",
  ).run();
  db.prepare(
    "insert into holdings (id, account_id, symbol, name, type, quantity, price, market_value, currency, network) values ('h-eth-base', 'smoke-wallet', 'ETH', 'Ether', 'crypto', 1, 2000, 2000, 'USD', 'base'), ('h-eth-eth', 'smoke-wallet', 'ETH', 'Ether', 'crypto', 1, 2000, 2000, 'USD', 'ethereum')",
  ).run();
  const addValue = db.prepare("insert into valuations (id, account_id, date, value, currency) values (?, ?, '2026-01-01', ?, ?)");
  addValue.run("v1", "smoke-value", 100, "USD");
  addValue.run("v2", "smoke-eur", 100, "EUR");
  addValue.run("v3", "smoke-debt", 10, "USD");
  db.prepare(
    "insert into holdings (id, account_id, symbol, name, type, quantity, price, market_value, currency) values ('h1', 'smoke-holdings', 'VOO', 'VOO', 'etf', 1, 500, 500, 'USD')",
  ).run();
  db.prepare("insert into valuations (id, account_id, date, value, currency) values ('v4', 'smoke-value', ?, 120, 'USD')").run(
    daysAgo(3),
  );
  // A few days of history so the charts render.
  const addSnapshot = db.prepare(
    "insert into snapshots (id, date, base_currency, assets, debts, net_worth) values (?, ?, 'USD', ?, 10, ?)",
  );
  const addSnapshotAccount = db.prepare(
    "insert into snapshot_accounts (snapshot_id, account_id, category_id, native_value, native_currency, base_value, counted) values (?, 'smoke-holdings', ?, ?, 'USD', ?, 1)",
  );
  for (const [i, value] of [480, 510, 495, 500].entries()) {
    addSnapshot.run(`s${i}`, daysAgo(40 - i * 10), value + 200, value + 190);
    addSnapshotAccount.run(`s${i}`, cat("Investments"), value, value);
  }
  db.close();

  const routes = [
    "/",
    "/?hidden=1",
    "/?range=1m&hidden=1",
    "/accounts/new",
    "/accounts/smoke-value",
    "/accounts/smoke-eur",
    "/accounts/smoke-holdings",
    "/accounts/smoke-debt",
    "/import",
    "/connections",
    "/settings",
  ];
  // Pages that must contain specific content (charts are labelled with their trend).
  const charts = [
    ["/?range=all", 'aria-label="Net worth over time:'],
    ["/accounts/smoke-value?range=all", 'aria-label="Value over time:'],
    ["/accounts/smoke-holdings?range=1y", 'aria-label="Value over time:'],
    ["/accounts/smoke-wallet", "0x000000000000000000000000000000000000dead"],
    ["/accounts/smoke-wallet", "text-[11px] leading-4 text-muted\">Base</span>"],
    ["/connections", "Add a wallet"],
    ["/settings", "Blockchain endpoints"],
  ];
  const results = [
    ...empty,
    ...(await Promise.all(routes.map((r) => get(r)))),
    ...(await Promise.all(charts.map(([r, text]) => get(r, text)))),
  ];
  // Private mode is read from a cookie on the server so pages render already masked.
  const privateHome = await get("/", "data-private", { cookie: "openqian-private=1" });
  results.push({ route: "/ (private mode)", problem: privateHome.problem });
  const missing = await get("/accounts/does-not-exist");
  results.push({ route: missing.route, problem: missing.problem === "HTTP 404" ? null : missing.problem ?? "expected 404" });

  for (const r of results) {
    console.log(`${r.problem ? "✗" : "✓"} ${r.route}${r.problem ? ` — ${r.problem}` : ""}`);
    if (r.problem) failed = true;
  }
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
if (failed) {
  console.error("\nServer log:\n" + log.slice(-4000));
  process.exit(1);
}
