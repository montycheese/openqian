"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { accounts, categories, connections, holdingTypes, holdings, settings, valuations } from "@/lib/db/schema";
import { deleteSecret } from "@/lib/secrets";

// Server Actions are reachable by direct POST. The server only listens on
// 127.0.0.1 and Next.js rejects cross-origin action requests, so there is no
// per-user authorization to check here; every input is still validated.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Pick a 3-letter currency code");
const optionalText = z
  .string()
  .trim()
  .transform((s) => s || null)
  .nullable()
  .optional();
const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number({ error: "Enter a number" }).finite().nullable(),
);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

function fields(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function fail(result: { error: z.ZodError }): ActionState {
  return { error: result.error.issues[0]?.message ?? "Invalid input" };
}

function refresh() {
  revalidatePath("/", "layout");
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------- Accounts ----------

const accountInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  institution: optionalText,
  categoryId: z.string().min(1, "Pick a category"),
  currency,
  notes: optionalText,
});

export async function createAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = accountInput
    .extend({
      kind: z.enum(["value", "holdings"]),
      initialValue: optionalNumber,
    })
    .safeParse(fields(formData));
  if (!parsed.success) return fail(parsed);
  const { initialValue, ...values } = parsed.data;

  const db = getDb();
  const category = db.select().from(categories).where(eq(categories.id, values.categoryId)).get();
  if (!category) return { error: "Unknown category" };
  if (category.kind === "debt" && values.kind === "holdings") {
    return { error: "Debts are tracked as a single value" };
  }

  const id = db.transaction((tx) => {
    const [row] = tx.insert(accounts).values(values).returning({ id: accounts.id }).all();
    if (values.kind === "value" && initialValue !== null) {
      tx.insert(valuations)
        .values({ accountId: row.id, date: today(), value: initialValue, currency: values.currency })
        .run();
    }
    return row.id;
  });
  refresh();
  redirect(`/accounts/${id}`);
}

export async function updateAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = accountInput
    .extend({
      id: z.string(),
      isHidden: z.literal("on").optional(),
      isExcluded: z.literal("on").optional(),
    })
    .safeParse(fields(formData));
  if (!parsed.success) return fail(parsed);
  const { id, isHidden, isExcluded, ...values } = parsed.data;
  const db = getDb();
  const category = db.select().from(categories).where(eq(categories.id, values.categoryId)).get();
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!category || !account) return { error: "Account or category not found" };
  if (category.kind === "debt" && account.kind === "holdings") {
    return { error: "A holdings account can't be moved into a debt category" };
  }
  db.update(accounts)
    .set({ ...values, isHidden: isHidden === "on", isExcluded: isExcluded === "on" })
    .where(eq(accounts.id, id))
    .run();
  refresh();
  return { ok: true };
}

export async function deleteAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: z.string(), confirm: z.literal("on", { error: "Tick the box to confirm" }) }).safeParse(fields(formData));
  if (!parsed.success) return fail(parsed);
  const db = getDb();
  // Connections cascade with the account; their stored credentials must go too.
  for (const c of db.select().from(connections).where(eq(connections.accountId, parsed.data.id)).all()) {
    deleteSecret(db, `connection:${c.id}`);
  }
  db.delete(accounts).where(eq(accounts.id, parsed.data.id)).run();
  refresh();
  redirect("/");
}

// ---------- Valuations ----------

export async function addValuation(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      accountId: z.string(),
      date: isoDate,
      value: optionalNumber,
      quantity: optionalNumber,
      unitPrice: optionalNumber,
      note: optionalText,
    })
    .safeParse(fields(formData));
  if (!parsed.success) return fail(parsed);
  const { quantity, unitPrice, value, ...rest } = parsed.data;

  let finalValue = value;
  if (quantity !== null && unitPrice !== null) finalValue = quantity * unitPrice;
  if (finalValue === null) return { error: "Enter a value, or a quantity and price per unit" };

  const db = getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, rest.accountId)).get();
  if (!account || account.kind !== "value") return { error: "Account not found" };
  db.insert(valuations)
    .values({ ...rest, value: finalValue, quantity, unitPrice, currency: account.currency })
    .run();
  refresh();
  return { ok: true };
}

export async function deleteValuation(formData: FormData) {
  const id = z.string().parse(formData.get("id"));
  getDb().delete(valuations).where(eq(valuations.id, id)).run();
  refresh();
}

// ---------- Holdings ----------

export async function saveHolding(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      id: optionalText,
      accountId: z.string(),
      symbol: z
        .string()
        .trim()
        .toUpperCase()
        .transform((s) => s || null),
      name: optionalText,
      type: z.enum(holdingTypes),
      quantity: optionalNumber,
      price: optionalNumber,
      marketValue: optionalNumber,
      costBasis: optionalNumber,
      currency,
    })
    .safeParse(fields(formData));
  if (!parsed.success) return fail(parsed);
  const { id, name, marketValue, ...h } = parsed.data;

  const value = h.quantity !== null && h.price !== null ? h.quantity * h.price : marketValue;
  if (value === null) return { error: "Enter quantity and price, or a market value" };
  if (!h.symbol && !name) return { error: "Enter a symbol or a name" };

  const db = getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, h.accountId)).get();
  if (!account || account.kind !== "holdings") return { error: "Account not found" };

  const row = {
    ...h,
    name: name ?? h.symbol!,
    marketValue: value,
    priceSource: "manual" as const,
    priceAsOf: h.price !== null ? new Date() : null,
  };
  if (id) {
    db.update(holdings)
      .set(row)
      .where(and(eq(holdings.id, id), eq(holdings.accountId, h.accountId)))
      .run();
  } else {
    db.insert(holdings).values(row).run();
  }
  refresh();
  return { ok: true };
}

export async function deleteHolding(formData: FormData) {
  const id = z.string().parse(formData.get("id"));
  getDb().delete(holdings).where(eq(holdings.id, id)).run();
  refresh();
}

// ---------- Settings ----------

export async function setBaseCurrency(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ baseCurrency: currency }).safeParse(fields(formData));
  if (!parsed.success) return fail(parsed);
  getDb()
    .insert(settings)
    .values({ key: "base_currency", value: parsed.data.baseCurrency })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed.data.baseCurrency } })
    .run();
  refresh();
  return { ok: true };
}

export async function saveCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      id: optionalText,
      name: z.string().trim().min(1, "Name is required"),
      kind: z.enum(["asset", "debt"]),
      sortOrder: z.coerce.number().int().default(0),
    })
    .safeParse(fields(formData));
  if (!parsed.success) return fail(parsed);
  const { id, ...values } = parsed.data;
  const db = getDb();
  if (id) {
    if (values.kind === "debt") {
      const holdingsAccount = db
        .select()
        .from(accounts)
        .where(and(eq(accounts.categoryId, id), eq(accounts.kind, "holdings")))
        .get();
      if (holdingsAccount) return { error: "This category has holdings accounts, so it can't be a debt category" };
    }
    db.update(categories).set(values).where(eq(categories.id, id)).run();
  } else {
    db.insert(categories).values(values).run();
  }
  refresh();
  return { ok: true };
}

export async function deleteCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  const id = z.string().parse(formData.get("id"));
  const db = getDb();
  if (db.select().from(accounts).where(eq(accounts.categoryId, id)).get()) {
    return { error: "Move or delete this category's accounts first" };
  }
  db.delete(categories).where(eq(categories.id, id)).run();
  refresh();
  return { ok: true };
}
