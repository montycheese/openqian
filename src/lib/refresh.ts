"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions";
import { refreshAllConnections } from "@/lib/connections/actions";
import { refreshFxStep } from "@/lib/fx/actions";
import { refreshPricesStep } from "@/lib/prices/actions";
import { recordSnapshot } from "@/lib/snapshots";

/**
 * The dashboard's one button: exchange balances, then market prices, then FX
 * rates last so currencies introduced by new quotes get a rate too. One snapshot
 * is taken at the end, after all values are current.
 */
export async function refreshAll(): Promise<ActionState> {
  const connections = await refreshAllConnections();
  const prices = await refreshPricesStep();
  const fx = await refreshFxStep();
  recordSnapshot();
  revalidatePath("/", "layout");

  const results = [connections, prices, fx];
  const problems = results.map((r) => r.error).filter(Boolean);
  const notes = results.map((r) => r.message).filter(Boolean);
  return problems.length > 0
    ? { error: [...problems, ...notes].join(" ") }
    : { ok: true, message: notes.join(" ") || undefined };
}
