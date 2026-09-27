import { eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { ActionForm } from "@/components/action-form";
import { Field, Select } from "@/components/fields";
import { addConnection, refreshConnection, removeConnection } from "@/lib/connections/actions";
import { EXCHANGE_LABELS } from "@/lib/connections/exchange";
import { getDb } from "@/lib/db";
import { accounts, connections, exchanges, wallets } from "@/lib/db/schema";
import { walletChains } from "@/lib/wallets";
import { addWallet, refreshWalletAction, removeWallet } from "@/lib/wallets/actions";
import { chainById, chainsInFamily } from "@/lib/wallets/chains";

export default async function ConnectionsPage() {
  await connection();
  const rows = getDb()
    .select({ connection: connections, account: accounts })
    .from(connections)
    .innerJoin(accounts, eq(accounts.id, connections.accountId))
    .all();
  const walletRows = getDb()
    .select({ wallet: wallets, account: accounts })
    .from(wallets)
    .innerJoin(accounts, eq(accounts.id, wallets.accountId))
    .all();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted">
          Crypto exchanges connected with read-only API keys, and watch-only wallet addresses. Exchange keys are
          encrypted on this computer and only used when you refresh.
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map(({ connection: c, account: a }) => (
            <li key={c.id} className="card space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/accounts/${a.id}`} className="block truncate font-medium underline-offset-2 hover:underline">
                    {a.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {EXCHANGE_LABELS[c.exchange]} ·{" "}
                    {c.lastRefreshedAt ? `refreshed ${c.lastRefreshedAt.toLocaleString("en-US")}` : "never refreshed"}
                  </p>
                </div>
                <span className={`text-xs ${c.status === "ok" ? "text-positive" : "text-negative"}`}>
                  {c.status === "ok" ? "Connected" : "Error"}
                </span>
              </div>
              {c.lastError && <p className="text-sm text-negative">{c.lastError}</p>}
              <div className="flex flex-wrap gap-2">
                <ActionForm action={refreshConnection} submitLabel="Refresh" submitClassName="btn" className="space-y-2">
                  <input type="hidden" name="id" value={c.id} />
                </ActionForm>
                <details>
                  <summary className="btn cursor-pointer list-none">Remove</summary>
                  <ActionForm action={removeConnection} submitLabel="Remove connection" submitClassName="btn-danger" className="mt-2 space-y-2">
                    <input type="hidden" name="id" value={c.id} />
                    <p className="text-sm text-muted">Deletes the saved key. The account and its last balances stay.</p>
                  </ActionForm>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="card p-5">
        <h2 className="font-medium">Add an exchange</h2>
        <details className="mt-2 text-sm text-muted">
          <summary className="cursor-pointer">How to create a read-only Coinbase key</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Sign in at the Coinbase Developer Platform (portal.cdp.coinbase.com) and open <b>API keys</b> → <b>Secret API
              keys</b> → <b>Create API key</b>.
            </li>
            <li>
              Under permissions, allow <b>View</b> only. Leave Trade and Transfer unchecked — OpenQian refuses keys that
              can trade or move funds.
            </li>
            <li>
              Copy the <b>API key name</b> (starts with <code>organizations/</code>, or a short key ID) and the <b>private
              key</b> (including the BEGIN/END lines, if present) into the form below.
            </li>
          </ol>
          <p className="mt-2">For other exchanges, create an API key with read/query permissions only.</p>
        </details>
        <ActionForm action={addConnection} submitLabel="Connect" successMessage="Connected" resetOnSuccess className="mt-4 space-y-4">
          <Select
            label="Exchange"
            name="exchange"
            options={exchanges.map((e) => ({ value: e, label: EXCHANGE_LABELS[e] }))}
          />
          <Field label="Account name" name="name" placeholder="Optional, e.g. Coinbase" />
          <Field label="API key" name="apiKey" required autoComplete="off" spellCheck={false} />
          <label className="block">
            <span className="label">API secret / private key</span>
            <textarea name="secret" required rows={4} className="input font-mono text-xs" autoComplete="off" spellCheck={false} />
          </label>
        </ActionForm>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Wallets</h2>
          <p className="mt-1 text-sm text-muted">
            Watch-only addresses read from free public blockchain endpoints. No keys are needed or stored — only the
            public address. Note that the endpoint providers can see which addresses you look up.
          </p>
        </div>

        {walletRows.length > 0 && (
          <ul className="space-y-3">
            {walletRows.map(({ wallet: w, account: a }) => (
              <li key={w.id} className="card space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/accounts/${a.id}`} className="block truncate font-medium underline-offset-2 hover:underline">
                      {a.name}
                    </Link>
                    <p className="truncate font-mono text-xs text-muted">{w.address}</p>
                    <p className="text-xs text-muted">
                      {walletChains(w)
                        .map((id) => chainById(id)?.label ?? id)
                        .join(", ")}{" "}
                      · {w.lastRefreshedAt ? `refreshed ${w.lastRefreshedAt.toLocaleString("en-US")}` : "not loaded yet"}
                    </p>
                  </div>
                  <span className={`text-xs ${w.status === "ok" ? "text-positive" : "text-negative"}`}>
                    {w.status === "ok" ? "OK" : "Error"}
                  </span>
                </div>
                {w.lastError && <p className="text-sm text-negative">{w.lastError}</p>}
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={refreshWalletAction} submitLabel="Refresh" submitClassName="btn" className="space-y-2">
                    <input type="hidden" name="id" value={w.id} />
                  </ActionForm>
                  <details>
                    <summary className="btn cursor-pointer list-none">Remove</summary>
                    <ActionForm action={removeWallet} submitLabel="Stop tracking" submitClassName="btn-danger" className="mt-2 space-y-2">
                      <input type="hidden" name="id" value={w.id} />
                      <p className="text-sm text-muted">The account and its last balances stay.</p>
                    </ActionForm>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="card p-5">
          <h3 className="font-medium">Add a wallet</h3>
          <ActionForm action={addWallet} submitLabel="Add wallet" successMessage="Wallet added" resetOnSuccess className="mt-4 space-y-4">
            <Field
              label="Address"
              name="address"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…, Solana address, or bc1…/1…/3…"
              hint="The chain is detected from the address format."
            />
            <Field label="Account name" name="name" placeholder="Optional, e.g. Ledger" />
            <fieldset>
              <legend className="label">Networks for 0x (EVM) addresses</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {chainsInFamily("evm").map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input type="checkbox" name="chains" value={c.id} defaultChecked className="h-4 w-4 accent-accent" />
                    {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
