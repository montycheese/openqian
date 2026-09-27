import { eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { ActionForm } from "@/components/action-form";
import { Field, Select } from "@/components/fields";
import { addConnection, refreshConnection, removeConnection } from "@/lib/connections/actions";
import { EXCHANGE_LABELS } from "@/lib/connections/exchange";
import { getDb } from "@/lib/db";
import { accounts, connections, exchanges } from "@/lib/db/schema";

export default async function ConnectionsPage() {
  await connection();
  const rows = getDb()
    .select({ connection: connections, account: accounts })
    .from(connections)
    .innerJoin(accounts, eq(accounts.id, connections.accountId))
    .all();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted">
          Crypto exchanges connected with read-only API keys. Keys are encrypted on this computer and only used when you
          refresh.
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
              Under permissions, allow <b>View</b> only. Leave Trade and Transfer unchecked — OpenChieng refuses keys that
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
    </div>
  );
}
