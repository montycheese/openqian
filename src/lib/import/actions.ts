"use server";

import { and, eq, isNotNull, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { accounts, categories, holdingTypes, holdings, imports, valuations } from "@/lib/db/schema";
import { parseOfx, type BalancesImport } from "./ofx";
import { parseHoldingsTable, type HoldingsImport } from "./parse-holdings";
import { readTable } from "./read-table";

const MAX_BYTES = 5 * 1024 * 1024;
const SUPPORTED = [".csv", ".xlsx", ".ofx", ".qfx"];

/** Existing account id matched by account-number mask, per parsed account. */
type Matches = { matches: (string | null)[] };

export type ImportPreview = {
  fileName: string;
  holdings: (HoldingsImport & Matches) | null;
  balances: (BalancesImport & Matches) | null;
};

export type PreviewState = { error?: string; preview?: ImportPreview };

function matchByMask(kind: "value" | "holdings", masks: (string | null)[]): (string | null)[] {
  const existing = getDb()
    .select({ id: accounts.id, mask: accounts.accountMask })
    .from(accounts)
    .where(and(eq(accounts.kind, kind), isNotNull(accounts.accountMask)))
    .all();
  return masks.map((m) => (m && existing.find((e) => e.mask === m)?.id) || null);
}

export async function previewImport(_: PreviewState, formData: FormData): Promise<PreviewState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to import" };
  if (file.size > MAX_BYTES) return { error: "File is larger than 5 MB" };
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!SUPPORTED.includes(ext)) return { error: `Unsupported file type. Use ${SUPPORTED.join(", ")}.` };

  try {
    let holdingsResult: HoldingsImport | null = null;
    let balancesResult: BalancesImport | null = null;
    if (ext === ".ofx" || ext === ".qfx") {
      const ofx = parseOfx(await file.text(), file.name);
      holdingsResult = ofx.holdings;
      balancesResult = ofx.balances;
    } else {
      holdingsResult = parseHoldingsTable(await readTable(file.name, await file.arrayBuffer()), file.name);
    }
    return {
      preview: {
        fileName: file.name,
        holdings: holdingsResult && {
          ...holdingsResult,
          matches: matchByMask("holdings", holdingsResult.accounts.map((a) => a.mask)),
        },
        balances: balancesResult && {
          ...balancesResult,
          matches: matchByMask("value", balancesResult.accounts.map((a) => a.mask)),
        },
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't read this file" };
  }
}

const holdingSchema = z.object({
  symbol: z.string().nullable(),
  name: z.string().min(1),
  type: z.enum(holdingTypes),
  quantity: z.number().finite().nullable(),
  price: z.number().finite().nullable(),
  marketValue: z.number().finite(),
  costBasis: z.number().finite().nullable(),
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const target = {
  target: z.string().min(1), // existing account id, "new", or "skip"
  name: z.string().trim(),
  categoryId: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  mask: z.string().nullable(),
};

const applySchema = z.object({
  fileName: z.string().min(1),
  institution: z.string().nullable(),
  asOf: date,
  accounts: z.array(z.object({ ...target, holdings: z.array(holdingSchema).min(1) })).default([]),
  balances: z.array(z.object({ ...target, balance: z.number().finite(), asOf: date })).default([]),
});

export type ApplyState = {
  error?: string;
  imported?: { accountId: string; name: string; summary: string }[];
};

export async function applyImport(_: ApplyState, formData: FormData): Promise<ApplyState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload")));
  } catch {
    return { error: "Invalid import data" };
  }
  const parsed = applySchema.safeParse(payload);
  if (!parsed.success) return { error: "Invalid import data" };
  const data = parsed.data;
  const chosenHoldings = data.accounts.filter((a) => a.target !== "skip");
  const chosenBalances = data.balances.filter((a) => a.target !== "skip");
  if (chosenHoldings.length + chosenBalances.length === 0) return { error: "Choose at least one account to import" };
  if ([...chosenHoldings, ...chosenBalances].some((a) => a.target === "new" && !a.name)) {
    return { error: "Give each new account a name" };
  }

  const db = getDb();
  const note = `Imported from ${data.fileName}`;
  try {
    const imported = db.transaction((tx) => {
      function resolveAccount(a: z.infer<typeof applySchema>["accounts"][number] | z.infer<typeof applySchema>["balances"][number], kind: "value" | "holdings") {
        if (a.target === "new") {
          const [row] = tx
            .insert(accounts)
            .values({
              name: a.name,
              institution: data.institution,
              categoryId: a.categoryId,
              kind,
              currency: a.currency,
              source: "import",
              accountMask: a.mask,
            })
            .returning()
            .all();
          return row;
        }
        const existing = tx.select().from(accounts).where(eq(accounts.id, a.target)).get();
        if (!existing || existing.kind !== kind) throw new Error("The chosen account can't receive this import");
        tx.update(accounts)
          .set({ source: "import", accountMask: a.mask ?? existing.accountMask })
          .where(eq(accounts.id, existing.id))
          .run();
        return existing;
      }

      const results: NonNullable<ApplyState["imported"]> = [];
      const priceAsOf = new Date(`${data.asOf}T00:00:00Z`);
      for (const a of chosenHoldings) {
        const account = resolveAccount(a, "holdings");
        // A positions import is a full snapshot of the account.
        tx.delete(holdings).where(eq(holdings.accountId, account.id)).run();
        tx.insert(holdings)
          .values(
            a.holdings.map((h) => ({
              ...h,
              accountId: account.id,
              currency: a.currency,
              priceSource: "import" as const,
              priceAsOf: h.price !== null ? priceAsOf : null,
            })),
          )
          .run();
        const total = a.holdings.reduce((s, h) => s + h.marketValue, 0);
        tx.insert(imports)
          .values({ accountId: account.id, fileName: data.fileName, asOf: data.asOf, positions: a.holdings.length, totalValue: total })
          .run();
        results.push({ accountId: account.id, name: account.name, summary: `${a.holdings.length} position${a.holdings.length === 1 ? "" : "s"}` });
      }

      for (const b of chosenBalances) {
        const account = resolveAccount(b, "value");
        const category = tx.select().from(categories).where(eq(categories.id, account.categoryId)).get();
        // Statements report money owed as negative; debt accounts track it as a positive amount.
        const value = category?.kind === "debt" ? -b.balance : b.balance;
        // Re-importing the same day's statement replaces the earlier imported value.
        tx.delete(valuations)
          .where(and(eq(valuations.accountId, account.id), eq(valuations.date, b.asOf), like(valuations.note, "Imported from %")))
          .run();
        tx.insert(valuations).values({ accountId: account.id, date: b.asOf, value, currency: b.currency, note }).run();
        tx.insert(imports)
          .values({ accountId: account.id, fileName: data.fileName, asOf: b.asOf, positions: 0, totalValue: value })
          .run();
        results.push({ accountId: account.id, name: account.name, summary: `balance as of ${b.asOf}` });
      }
      return results;
    });
    revalidatePath("/", "layout");
    return { imported };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Import failed" };
  }
}
