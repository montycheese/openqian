import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "@/lib/db";

// In-memory stand-in for the OS keychain.
const store = new Map<string, string>();
vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    constructor(
      private service: string,
      private account: string,
    ) {}
    getPassword() {
      return store.get(`${this.service}/${this.account}`) ?? null;
    }
    setPassword(value: string) {
      store.set(`${this.service}/${this.account}`, value);
    }
  },
}));

describe("master key", () => {
  it("reuses the key stored under the pre-rename keychain service", async () => {
    delete process.env.OPENQIAN_PASSPHRASE;
    const legacyKey = Buffer.alloc(32, 7).toString("base64");
    store.set("OpenChieng/master-key", legacyKey);
    const { getMasterKey } = await import("@/lib/secrets");
    const key = await getMasterKey(openDatabase(":memory:"));
    expect(key.toString("base64")).toBe(legacyKey);
    expect(store.get("OpenQian/master-key")).toBe(legacyKey);
  });
});
