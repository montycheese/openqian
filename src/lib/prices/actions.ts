"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions";
import { getDb } from "@/lib/db";
import { recordSnapshot } from "@/lib/snapshots";
import { refreshPrices } from "./index";

/** Refreshes feed prices for all manually tracked and imported holdings. */
export async function refreshPricesAction(): Promise<ActionState> {
  const result = await refreshPricesStep();
  recordSnapshot();
  revalidatePath("/", "layout");
  return result;
}

/** Refreshes prices without taking a snapshot, for use inside refreshAll. */
export async function refreshPricesStep(): Promise<ActionState> {
  const { updated, unpriced, errors } = await refreshPrices(getDb());

  const notes = [
    unpriced.length > 0 && `No price found for ${unpriced.join(", ")}; those keep their last value.`,
    ...errors.map((e) => `${e}.`),
  ].filter((n): n is string => Boolean(n));

  if (updated === 0 && errors.length > 0) return { error: `Couldn't refresh prices. ${notes.join(" ")}` };
  const summary = updated === 1 ? "Updated 1 holding." : `Updated ${updated} holdings.`;
  return { ok: true, message: [summary, ...notes].join(" ") };
}
