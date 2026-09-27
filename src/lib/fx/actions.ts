"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/actions";
import { getDb } from "@/lib/db";
import { clearManualRate, readBaseCurrency, refreshFxRates, setManualRate } from "@/lib/fx";

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Pick a 3-letter currency code");

const fields = (formData: FormData) => Object.fromEntries(formData.entries());
const fail = (error: z.ZodError): ActionState => ({ error: error.issues[0]?.message ?? "Invalid input" });

export async function refreshFxAction(): Promise<ActionState> {
  const result = await refreshFxRates(getDb());
  revalidatePath("/", "layout");
  if (result.error) return { error: `Couldn't refresh rates: ${result.error}` };
  if (result.unsupported.length > 0) {
    return { ok: true, message: `No published rate for ${result.unsupported.join(", ")}. Set one manually below.` };
  }
  return { ok: true };
}

/** Saves "1 `currency` = `rate` base" as a manual override. */
export async function saveManualRate(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      currency,
      rate: z.coerce.number({ error: "Enter a rate" }).finite("Enter a rate").positive("Rate must be more than 0"),
    })
    .safeParse(fields(formData));
  if (!parsed.success) return fail(parsed.error);
  const db = getDb();
  const base = readBaseCurrency(db);
  if (parsed.data.currency === base) return { error: `${base} is already the base currency` };
  setManualRate(db, parsed.data.currency, base, parsed.data.rate);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearManualRateAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ base: currency, quote: currency }).safeParse(fields(formData));
  if (!parsed.success) return fail(parsed.error);
  clearManualRate(getDb(), parsed.data.base, parsed.data.quote);
  revalidatePath("/", "layout");
  return { ok: true };
}
