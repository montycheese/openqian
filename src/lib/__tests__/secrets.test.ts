import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/secrets";

describe("secret encryption", () => {
  const key = crypto.randomBytes(32);

  it("round-trips", () => {
    expect(decrypt(encrypt("access-token-123", key), key)).toBe("access-token-123");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("rejects tampered ciphertext and wrong keys", () => {
    const payload = encrypt("secret", key);
    const parts = payload.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"), key)).toThrow();
    expect(() => decrypt(payload, crypto.randomBytes(32))).toThrow();
  });
});
