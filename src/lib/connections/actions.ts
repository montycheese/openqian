"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/actions";
import { getDb } from "@/lib/db";
import { accounts, categories, connections, exchanges, holdings } from "@/lib/db/schema";
import { deleteSecret, getSecret, setSecret } from "@/lib/secrets";
import {
  createExchange,
  EXCHANGE_LABELS,
  excessPermissions,
  fetchPositions,
  type ExchangeCredentials,
  type ExchangePosition,
} from "./exchange";

type ConnectionState = ActionState;

const secretName = (connectionId: string) => `connection:${connectionId}`;

function describeError(err: unknown): string {
  const name = err instanceof Error ? err.constructor.name : "";
  if (name === "AuthenticationError" || name === "PermissionDenied") {
    return "The exchange rejected these credentials. Check the API key and secret.";
  }
  if (name === "NetworkError" || name === "RequestTimeout" || name === "ExchangeNotAvailable") {
    return "Couldn't reach the exchange. Check your internet connection and try again.";
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

function replaceHoldings(accountId: string, positions: ExchangePosition[]) {
  const now = new Date();
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(holdings).where(eq(holdings.accountId, accountId)).run();
    if (positions.length > 0) {
      tx.insert(holdings)
        .values(positions.map((p) => ({ ...p, accountId, priceSource: "feed" as const, priceAsOf: p.price !== null ? now : null })))
        .run();
    }
  });
}

const unpricedMessage = (unpriced: string[]) =>
  unpriced.length ? `No USD price found for ${unpriced.join(", ")}; those are shown with a $0 value.` : undefined;

export async function addConnection(_: ConnectionState, formData: FormData): Promise<ConnectionState> {
  const parsed = z
    .object({
      exchange: z.enum(exchanges),
      name: z.string().trim(),
      apiKey: z.string().trim().min(1, "Enter the API key"),
      secret: z.string().trim().min(1, "Enter the API secret / private key"),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { exchange: exchangeId, name, ...credentials } = parsed.data;

  let result: Awaited<ReturnType<typeof fetchPositions>>;
  try {
    const exchange = await createExchange(exchangeId, credentials);
    const excess = await excessPermissions(exchangeId, exchange);
    if (excess && excess.length > 0) {
      return {
        error: `This key can ${excess.join(" and ")}. OpenChieng only needs to view balances — create a key with "View" permission only.`,
      };
    }
    result = await fetchPositions(exchange);
  } catch (err) {
    return { error: describeError(err) };
  }

  const db = getDb();
  const crypto = db.select().from(categories).all().find((c) => c.name === "Crypto" && c.kind === "asset");
  const category = crypto ?? db.select().from(categories).where(eq(categories.kind, "asset")).get();
  if (!category) return { error: "Create an asset category first" };

  const label = EXCHANGE_LABELS[exchangeId];
  const connectionId = globalThis.crypto.randomUUID();
  await setSecret(db, secretName(connectionId), JSON.stringify(credentials satisfies ExchangeCredentials));
  const [account] = db
    .insert(accounts)
    .values({
      name: name || label,
      institution: label,
      categoryId: category.id,
      kind: "holdings",
      currency: "USD",
      source: "connection",
    })
    .returning()
    .all();
  db.insert(connections)
    .values({ id: connectionId, provider: "ccxt", exchange: exchangeId, accountId: account.id, lastRefreshedAt: new Date() })
    .run();
  replaceHoldings(account.id, result.positions);
  revalidatePath("/", "layout");
  return { ok: true, message: unpricedMessage(result.unpriced) };
}

async function refresh(connectionId: string): Promise<ConnectionState> {
  const db = getDb();
  const conn = db.select().from(connections).where(eq(connections.id, connectionId)).get();
  if (!conn) return { error: "Connection not found" };
  try {
    const stored = await getSecret(db, secretName(conn.id));
    if (!stored) throw new Error("Saved credentials are missing. Remove this connection and add it again.");
    const exchange = await createExchange(conn.exchange, JSON.parse(stored) as ExchangeCredentials);
    const { positions, unpriced } = await fetchPositions(exchange);
    replaceHoldings(conn.accountId, positions);
    db.update(connections)
      .set({ status: "ok", lastError: null, lastRefreshedAt: new Date() })
      .where(eq(connections.id, conn.id))
      .run();
    return { ok: true, message: unpricedMessage(unpriced) };
  } catch (err) {
    const error = describeError(err);
    db.update(connections).set({ status: "error", lastError: error }).where(eq(connections.id, conn.id)).run();
    return { error };
  }
}

export async function refreshConnection(_: ConnectionState, formData: FormData): Promise<ConnectionState> {
  const result = await refresh(z.string().parse(formData.get("id")));
  revalidatePath("/", "layout");
  return result;
}

export async function refreshAllConnections(): Promise<ConnectionState> {
  const all = getDb().select({ id: connections.id }).from(connections).all();
  const results = await Promise.all(all.map((c) => refresh(c.id)));
  revalidatePath("/", "layout");
  const failed = results.filter((r) => r.error).length;
  return failed ? { error: `${failed} of ${all.length} connections failed to refresh` } : { ok: true };
}

/** Removes the connection and its stored credentials; the account and its last holdings stay. */
export async function removeConnection(_: ConnectionState, formData: FormData): Promise<ConnectionState> {
  const id = z.string().parse(formData.get("id"));
  const db = getDb();
  const conn = db.select().from(connections).where(eq(connections.id, id)).get();
  if (!conn) return { error: "Connection not found" };
  deleteSecret(db, secretName(id));
  db.delete(connections).where(eq(connections.id, id)).run();
  db.update(accounts).set({ source: "manual" }).where(eq(accounts.id, conn.accountId)).run();
  revalidatePath("/", "layout");
  return { ok: true };
}
