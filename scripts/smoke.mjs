// Starts the production build against a throwaway database, seeds a few
// accounts, and requests every page. Exits non-zero on any failing page.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const port = 3900 + Math.floor(Math.random() * 90);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchieng-smoke-"));
const base = `http://127.0.0.1:${port}`;
const server = spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

async function get(route) {
  const res = await fetch(base + route);
  const body = await res.text();
  const problem = res.status !== 200 ? `HTTP ${res.status}` : /Application error|Internal Server Error/.test(body) ? "error page" : null;
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
  const empty = await Promise.all(["/", "/settings"].map(get));
  const db = new Database(path.join(dataDir, "openchieng.db"));
  const cat = (name) => db.prepare("select id from categories where name = ?").get(name).id;
  const addAccount = db.prepare(
    "insert into accounts (id, name, category_id, kind, currency) values (?, ?, ?, ?, ?)",
  );
  addAccount.run("smoke-value", "Checking", cat("Cash"), "value", "USD");
  addAccount.run("smoke-eur", "Euro savings", cat("Cash"), "value", "EUR");
  addAccount.run("smoke-holdings", "Brokerage", cat("Investments"), "holdings", "USD");
  addAccount.run("smoke-debt", "Card", cat("Credit Cards"), "value", "USD");
  const addValue = db.prepare("insert into valuations (id, account_id, date, value, currency) values (?, ?, '2026-01-01', ?, ?)");
  addValue.run("v1", "smoke-value", 100, "USD");
  addValue.run("v2", "smoke-eur", 100, "EUR");
  addValue.run("v3", "smoke-debt", 10, "USD");
  db.prepare(
    "insert into holdings (id, account_id, symbol, name, type, quantity, price, market_value, currency) values ('h1', 'smoke-holdings', 'VOO', 'VOO', 'etf', 1, 500, 500, 'USD')",
  ).run();
  db.close();

  const routes = [
    "/",
    "/?hidden=1",
    "/accounts/new",
    "/accounts/smoke-value",
    "/accounts/smoke-eur",
    "/accounts/smoke-holdings",
    "/accounts/smoke-debt",
    "/import",
    "/connections",
    "/settings",
  ];
  const results = [...empty, ...(await Promise.all(routes.map(get)))];
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
