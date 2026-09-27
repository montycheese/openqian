"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { applyImport, previewImport, type ImportPreview } from "@/lib/import/actions";
import { formatMoney, formatNumber } from "@/lib/money";
import { Sensitive } from "@/components/sensitive";

type Option = { value: string; label: string };
type Mapping = { target: string; name: string; categoryId: string };

export type ImportOptions = {
  holdingsAccounts: Option[];
  valueAccounts: Option[];
  assetCategories: Option[];
  allCategories: Option[];
  defaults: { investments: string; cash: string; credit: string };
  currency: string;
};

export function ImportFlow(options: ImportOptions) {
  const [previewState, previewAction, previewing] = useActionState(previewImport, {});
  const [applyState, applyAction, applying] = useActionState(applyImport, {});
  const preview = previewState.preview;

  if (applyState.imported) {
    return (
      <div className="card space-y-3 p-5">
        <p className="font-medium text-positive">Import complete</p>
        <ul className="text-sm">
          {applyState.imported.map((a) => (
            <li key={a.accountId}>
              <Link href={`/accounts/${a.accountId}`} className="underline">
                {a.name}
              </Link>{" "}
              — {a.summary}
            </li>
          ))}
        </ul>
        <Link href="/" className="btn-primary">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form
        className="card space-y-4 p-5"
        onSubmit={(e) => {
          // Not the `action` prop: React would reset the form and clear the chosen file.
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => previewAction(data));
        }}
      >
        <label className="block">
          <span className="label">Export file (.csv, .xlsx, .ofx, .qfx)</span>
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,.ofx,.qfx"
            required
            className="input file:mr-3 file:rounded file:border-0 file:bg-background file:px-2 file:py-1"
          />
        </label>
        {previewState.error && (
          <p role="alert" className="text-sm text-negative">
            {previewState.error}
          </p>
        )}
        <button type="submit" disabled={previewing} className="btn-primary">
          {previewing ? "Reading…" : "Preview"}
        </button>
      </form>

      {preview && (
        <Preview
          key={preview.fileName + (preview.holdings?.asOf ?? preview.balances?.asOf)}
          preview={preview}
          options={options}
          applyAction={applyAction}
          applying={applying}
          applyError={applyState.error}
        />
      )}
    </div>
  );
}

function Preview({
  preview,
  options,
  applyAction,
  applying,
  applyError,
}: {
  preview: ImportPreview;
  options: ImportOptions;
  applyAction: (formData: FormData) => void;
  applying: boolean;
  applyError?: string;
}) {
  const { holdings, balances } = preview;
  const institution = holdings?.institution ?? balances?.institution ?? null;
  const defaultName = (name: string, mask: string | null) =>
    [institution, name || null].filter(Boolean).join(" ") || (mask ? `Account …${mask}` : "Imported account");

  const [holdingMaps, setHoldingMaps] = useState<Mapping[]>(() =>
    (holdings?.accounts ?? []).map((a, i) => ({
      target: holdings!.matches[i] ?? "new",
      name: defaultName(a.name, a.mask),
      categoryId: options.defaults.investments,
    })),
  );
  const [balanceMaps, setBalanceMaps] = useState<Mapping[]>(() =>
    (balances?.accounts ?? []).map((a, i) => ({
      target: balances!.matches[i] ?? "new",
      name: defaultName(a.name, a.mask),
      categoryId: a.kind === "credit" ? options.defaults.credit : options.defaults.cash,
    })),
  );
  const patch = (set: typeof setHoldingMaps, i: number, p: Partial<Mapping>) =>
    set((m) => m.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const payload = JSON.stringify({
    fileName: preview.fileName,
    institution,
    asOf: holdings?.asOf ?? balances?.asOf,
    accounts: (holdings?.accounts ?? []).map((a, i) => ({
      ...holdingMaps[i],
      currency: options.currency,
      mask: a.mask,
      holdings: a.holdings,
    })),
    balances: (balances?.accounts ?? []).map((a, i) => ({
      ...balanceMaps[i],
      currency: a.currency,
      mask: a.mask,
      balance: a.balance,
      asOf: a.asOf,
    })),
  });

  const count = (holdings?.accounts.length ?? 0) + (balances?.accounts.length ?? 0);
  const warnings = [...(holdings?.warnings ?? []), ...(balances?.warnings ?? [])];

  return (
    <form action={applyAction} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="card space-y-1 p-5 text-sm">
        <p className="font-medium">{preview.fileName}</p>
        <p className="text-muted">
          {[institution, `as of ${holdings?.asOf ?? balances?.asOf}`, `${count} account${count === 1 ? "" : "s"}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {holdings?.checksum?.ok && (
          <p className="text-positive">
            ✓ Positions add up to the file&apos;s total (<Sensitive>{formatMoney(holdings.checksum.expected, options.currency)}</Sensitive>)
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className="rounded-lg bg-warning-bg px-3 py-2 text-warning-fg">
            {w}
          </p>
        ))}
      </div>

      {balances?.accounts.map((a, i) => (
        <section key={`b${i}`} className="card overflow-hidden">
          <AccountHeader name={a.name} mask={a.mask} amount={formatMoney(a.balance, a.currency)} />
          <TargetFields
            mapping={balanceMaps[i]}
            onChange={(p) => patch(setBalanceMaps, i, p)}
            accounts={options.valueAccounts}
            categories={options.allCategories}
            existingNote={`Adds this balance, dated ${a.asOf}, to the account's history.`}
          />
          {a.kind === "credit" && (
            <p className="px-4 pb-4 text-xs text-muted">
              Money owed is recorded as a debt when the account is in a debt category.
            </p>
          )}
        </section>
      ))}

      {holdings?.accounts.map((a, i) => (
        <section key={`h${i}`} className="card overflow-hidden">
          <AccountHeader name={a.name} mask={a.mask} amount={formatMoney(a.total, options.currency)} />
          <TargetFields
            mapping={holdingMaps[i]}
            onChange={(p) => patch(setHoldingMaps, i, p)}
            accounts={options.holdingsAccounts}
            categories={options.assetCategories}
            existingNote="This replaces the account's current holdings."
          />
          <details className="border-t border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm text-muted">
              {a.holdings.length} position{a.holdings.length === 1 ? "" : "s"}
            </summary>
            <ul className="divide-y divide-border text-sm">
              {a.holdings.map((h, j) => (
                <li key={j} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{h.symbol ?? h.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {h.quantity !== null && h.price !== null
                        ? <Sensitive>{`${formatNumber(h.quantity)} × ${formatMoney(h.price, options.currency)}`}</Sensitive>
                        : h.type}
                    </span>
                  </span>
                  <span className="num">
                    <Sensitive>{formatMoney(h.marketValue, options.currency)}</Sensitive>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ))}

      {applyError && (
        <p role="alert" className="text-sm text-negative">
          {applyError}
        </p>
      )}
      <button type="submit" disabled={applying} className="btn-primary w-full sm:w-auto">
        {applying ? "Importing…" : "Import"}
      </button>
    </form>
  );
}

function AccountHeader({ name, mask, amount }: { name: string; mask: string | null; amount: string }) {
  return (
    <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
      <span className="min-w-0 truncate font-medium">
        {name || "Account"} {mask && <span className="text-muted">…{mask}</span>}
      </span>
      <span className="num">
        <Sensitive>{amount}</Sensitive>
      </span>
    </header>
  );
}

function TargetFields({
  mapping,
  onChange,
  accounts,
  categories,
  existingNote,
}: {
  mapping: Mapping;
  onChange: (p: Partial<Mapping>) => void;
  accounts: Option[];
  categories: Option[];
  existingNote: string;
}) {
  return (
    <div className="space-y-4 px-4 py-4">
      <label className="block">
        <span className="label">Import into</span>
        <select className="input" value={mapping.target} onChange={(e) => onChange({ target: e.target.value })}>
          <option value="new">New account</option>
          {accounts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value="skip">Don&apos;t import</option>
        </select>
      </label>
      {mapping.target === "new" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">Account name</span>
            <input className="input" value={mapping.name} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Category</span>
            <select className="input" value={mapping.categoryId} onChange={(e) => onChange({ categoryId: e.target.value })}>
              {categories.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {mapping.target !== "new" && mapping.target !== "skip" && <p className="text-sm text-muted">{existingNote}</p>}
    </div>
  );
}
