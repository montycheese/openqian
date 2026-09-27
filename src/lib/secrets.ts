import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { secrets, settings } from "@/lib/db/schema";

const KEYRING_SERVICE = "OpenQian";
// Keychain service used before the project was renamed; its key is copied over once.
const LEGACY_KEYRING_SERVICE = "OpenChieng";
const KEYRING_ACCOUNT = "master-key";
const FORMAT = "v1";

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT, iv, tag, ct].map((p) => (typeof p === "string" ? p : p.toString("base64"))).join(":");
}

export function decrypt(payload: string, key: Buffer): string {
  const [format, iv, tag, ct] = payload.split(":");
  if (format !== FORMAT || !iv || !tag || ct === undefined) throw new Error("Unrecognized secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

let cachedKey: Buffer | undefined;

/**
 * The master key lives in the OS keychain (macOS Keychain, Windows Credential
 * Manager, Secret Service on Linux). Where no keychain is available, it is
 * derived from the OPENQIAN_PASSPHRASE environment variable instead.
 */
export async function getMasterKey(db: DB): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const passphrase = process.env.OPENQIAN_PASSPHRASE;
  if (passphrase) {
    cachedKey = deriveKey(db, passphrase);
    return cachedKey;
  }
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    let stored = entry.getPassword();
    if (!stored) {
      // Reuse a pre-rename key so existing encrypted secrets stay readable.
      stored = new Entry(LEGACY_KEYRING_SERVICE, KEYRING_ACCOUNT).getPassword() ?? crypto.randomBytes(32).toString("base64");
      entry.setPassword(stored);
    }
    cachedKey = Buffer.from(stored, "base64");
    return cachedKey;
  } catch (err) {
    throw new Error(
      "Could not access the OS keychain to load the encryption key. " +
        "Set OPENQIAN_PASSPHRASE to use a passphrase instead.",
      { cause: err },
    );
  }
}

function deriveKey(db: DB, passphrase: string): Buffer {
  const row = db.select().from(settings).where(eq(settings.key, "kdf_salt")).get();
  let salt = row?.value;
  if (!salt) {
    salt = crypto.randomBytes(16).toString("base64");
    db.insert(settings).values({ key: "kdf_salt", value: salt }).run();
  }
  return crypto.scryptSync(passphrase, Buffer.from(salt, "base64"), 32);
}

export async function setSecret(db: DB, name: string, value: string) {
  const ciphertext = encrypt(value, await getMasterKey(db));
  db.insert(secrets)
    .values({ name, ciphertext })
    .onConflictDoUpdate({ target: secrets.name, set: { ciphertext, updatedAt: new Date() } })
    .run();
}

export async function getSecret(db: DB, name: string): Promise<string | null> {
  const row = db.select().from(secrets).where(eq(secrets.name, name)).get();
  return row ? decrypt(row.ciphertext, await getMasterKey(db)) : null;
}

export function deleteSecret(db: DB, name: string) {
  db.delete(secrets).where(eq(secrets.name, name)).run();
}
