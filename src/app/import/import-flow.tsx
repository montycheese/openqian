"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { applyImport, previewImport, type PreviewState } from "@/lib/import/actions";
import { formatMoney, formatNumber } from "@/lib/money";

type Option = { value: string; label: string };
type Mapping = { target: string; name: string; categoryId: string };

export function ImportFlow({
  holdingsAccounts,
  categories,
  defaultCategoryId,
  currency,
}: {
  holdingsAccounts: Option[];
  categories: Option[];
  defaultCategoryId: string;
  currency: string;
}) {
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
              — {a.positions} positions
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
      <form action={previewAction} className="card space-y-4 p-5">
        <label className="block">
          <span className="label">Positions export (.csv or .xlsx)</span>
          <input type="file" name="file" accept=".csv,.xlsx" required className="input file:mr-3 file:rounded file:border-0 file:bg-background file:px-2 file:py-1" />
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
          key={preview.fileName + preview.asOf}
          preview={preview}
          holdingsAccounts={holdingsAccounts}
          categories={categories}
          defaultCategoryId={defaultCategoryId}
          currency={currency}
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
  holdingsAccounts,
  categories,
  defaultCategoryId,
  currency,
  applyAction,
  applying,
  applyError,
}: {
  preview: NonNullable<PreviewState["preview"]>;
  holdingsAccounts: Option[];
  categories: Option[];
  defaultCategoryId: string;
  currency: string;
  applyAction: (formData: FormData) => void;
  applying: boolean;
  applyError?: string;
}) {
  const [mappings, setMappings] = useState<Mapping[]>(() =>
    preview.accounts.map((a, i) => ({
      target: preview.matches[i] ?? "new",
      name: [preview.institution, a.name || null, a.mask ? `…${a.mask}` : null].filter(Boolean).join(" ") || "Imported account",
      categoryId: defaultCategoryId,
    })),
  );
  const update = (i: number, patch: Partial<Mapping>) =>
    setMappings((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const payload = JSON.stringify({
    fileName: preview.fileName,
    institution: preview.institution,
    asOf: preview.asOf,
    accounts: preview.accounts.map((a, i) => ({ ...mappings[i], currency, mask: a.mask, holdings: a.holdings })),
  });

  return (
    <form action={applyAction} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="card space-y-1 p-5 text-sm">
        <p className="font-medium">{preview.fileName}</p>
        <p className="text-muted">
          {[preview.institution, `as of ${preview.asOf}`, `${preview.accounts.length} account${preview.accounts.length === 1 ? "" : "s"}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {preview.checksum?.ok && (
          <p className="text-positive">
            ✓ Positions add up to the file&apos;s total ({formatMoney(preview.checksum.expected, currency)})
          </p>
        )}
        {preview.warnings.map((w) => (
          <p key={w} className="rounded-lg bg-warning-bg px-3 py-2 text-warning-fg">
            {w}
          </p>
        ))}
      </div>

      {preview.accounts.map((a, i) => (
        <section key={a.label + i} className="card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
            <span className="min-w-0 truncate font-medium">
              {a.name || "Account"} {a.mask && <span className="text-muted">…{a.mask}</span>}
            </span>
            <span className="num">{formatMoney(a.total, currency)}</span>
          </header>
          <div className="space-y-4 px-4 py-4">
            <label className="block">
              <span className="label">Import into</span>
              <select className="input" value={mappings[i].target} onChange={(e) => update(i, { target: e.target.value })}>
                <option value="new">New account</option>
                {holdingsAccounts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value="skip">Don&apos;t import</option>
              </select>
            </label>
            {mappings[i].target === "new" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Account name</span>
                  <input className="input" value={mappings[i].name} onChange={(e) => update(i, { name: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">Category</span>
                  <select className="input" value={mappings[i].categoryId} onChange={(e) => update(i, { categoryId: e.target.value })}>
                    {categories.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {mappings[i].target !== "new" && mappings[i].target !== "skip" && (
              <p className="text-sm text-muted">This replaces the account&apos;s current holdings.</p>
            )}
          </div>
          <details className="border-t border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm text-muted">{a.holdings.length} positions</summary>
            <ul className="divide-y divide-border text-sm">
              {a.holdings.map((h, j) => (
                <li key={j} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{h.symbol ?? h.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {h.quantity !== null && h.price !== null
                        ? `${formatNumber(h.quantity)} × ${formatMoney(h.price, currency)}`
                        : h.type}
                    </span>
                  </span>
                  <span className="num">{formatMoney(h.marketValue, currency)}</span>
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
