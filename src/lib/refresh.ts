"use server";

import type { ActionState } from "@/lib/actions";
import { refreshAllConnections } from "@/lib/connections/actions";
import { refreshPricesAction } from "@/lib/prices/actions";

/** The dashboard's one button: exchange balances first, then market prices. */
export async function refreshAll(): Promise<ActionState> {
  const connections = await refreshAllConnections();
  const prices = await refreshPricesAction();

  const problems = [connections.error, prices.error].filter(Boolean);
  const notes = [connections.message, prices.message].filter(Boolean);
  return problems.length > 0
    ? { error: [...problems, ...notes].join(" ") }
    : { ok: true, message: notes.join(" ") || undefined };
}
