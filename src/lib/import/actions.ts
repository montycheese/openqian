"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { accounts, holdingTypes, holdings, imports } from "@/lib/db/schema";
import { parseHoldingsTable, type HoldingsImport } from "./parse-holdings";
import { readTable, SUPPORTED_EXTENSIONS } from "./read-table";

const MAX_BYTES = 5 * 1024 * 1024;

export type PreviewState = {
  error?: string;
  preview?: HoldingsImport & {
    fileName: string;
    /** Existing account id matched by account-number mask, per parsed account. */
    matches: (string | null)[];
  };
};

export async function previewImport(_: PreviewState, formData: FormData): Promise<PreviewState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to import" };
  if (file.size > MAX_BYTES) return { error: "File is larger than 5 MB" };
  if (!SUPPORTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return { error: `Unsupported file type. Use ${SUPPORTED_EXTENSIONS.join(" or ")}.` };
  }
  try {
    const parsed = parseHoldingsTable(await readTable(file.name, await file.arrayBuffer()), file.name);
    const db = getDb();
    const masked = db
      .select({ id: accounts.id, mask: accounts.accountMask })
      .from(accounts)
      .where(and(eq(accounts.kind, "holdings"), isNotNull(accounts.accountMask)))
      .all();
    const matches = parsed.accounts.map((a) => (a.mask && masked.find((m) => m.mask === a.mask)?.id) || null);
    return { preview: { ...parsed, fileName: file.name, matches } };
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

const applySchema = z.object({
  fileName: z.string().min(1),
  institution: z.string().nullable(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accounts: z
    .array(
      z.object({
        target: z.string().min(1), // existing account id, "new", or "skip"
        name: z.string().trim(),
        categoryId: z.string(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        mask: z.string().nullable(),
        holdings: z.array(holdingSchema).min(1),
      }),
    )
    .min(1),
});

export type ApplyState = { error?: string; imported?: { accountId: string; name: string; positions: number }[] };

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
  const chosen = data.accounts.filter((a) => a.target !== "skip");
  if (chosen.length === 0) return { error: "Choose at least one account to import" };
  if (chosen.some((a) => a.target === "new" && !a.name)) return { error: "Give each new account a name" };

  const db = getDb();
  const priceAsOf = new Date(`${data.asOf}T00:00:00Z`);
  try {
    const imported = db.transaction((tx) =>
      chosen.map((a) => {
        let accountId = a.target;
        let name = a.name;
        if (a.target === "new") {
          const [row] = tx
            .insert(accounts)
            .values({
              name: a.name,
              institution: data.institution,
              categoryId: a.categoryId,
              kind: "holdings",
              currency: a.currency,
              source: "import",
              accountMask: a.mask,
            })
            .returning({ id: accounts.id })
            .all();
          accountId = row.id;
        } else {
          const existing = tx.select().from(accounts).where(eq(accounts.id, a.target)).get();
          if (!existing || existing.kind !== "holdings") throw new Error("Target account is not a holdings account");
          name = existing.name;
          tx.update(accounts)
            .set({ source: "import", accountMask: a.mask ?? existing.accountMask })
            .where(eq(accounts.id, accountId))
            .run();
        }

        // An import is a full snapshot of the account's positions.
        tx.delete(holdings).where(eq(holdings.accountId, accountId)).run();
        tx.insert(holdings)
          .values(
            a.holdings.map((h) => ({
              ...h,
              accountId,
              currency: a.currency,
              priceSource: "import" as const,
              priceAsOf: h.price !== null ? priceAsOf : null,
            })),
          )
          .run();
        tx.insert(imports)
          .values({
            accountId,
            fileName: data.fileName,
            asOf: data.asOf,
            positions: a.holdings.length,
            totalValue: a.holdings.reduce((s, h) => s + h.marketValue, 0),
          })
          .run();
        return { accountId, name, positions: a.holdings.length };
      }),
    );
    revalidatePath("/", "layout");
    return { imported };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Import failed" };
  }
}
