"use server";

import type { ActionState } from "@/lib/actions";
import { refreshAllConnections } from "@/lib/connections/actions";
import { refreshFxAction } from "@/lib/fx/actions";
import { refreshPricesAction } from "@/lib/prices/actions";

/**
 * The dashboard's one button: exchange balances, then market prices, then FX
 * rates last so currencies introduced by new quotes get a rate too.
 */
export async function refreshAll(): Promise<ActionState> {
  const connections = await refreshAllConnections();
  const prices = await refreshPricesAction();
  const fx = await refreshFxAction();

  const results = [connections, prices, fx];
  const problems = results.map((r) => r.error).filter(Boolean);
  const notes = results.map((r) => r.message).filter(Boolean);
  return problems.length > 0
    ? { error: [...problems, ...notes].join(" ") }
    : { ok: true, message: notes.join(" ") || undefined };
}
