import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataDir } from "@/lib/paths";

describe("dataDir", () => {
  it("honors DATA_DIR", () => {
    expect(dataDir({ DATA_DIR: "/tmp/oc" }, "darwin")).toBe(path.resolve("/tmp/oc"));
  });

  it("uses Application Support on macOS", () => {
    expect(dataDir({}, "darwin")).toMatch(/Library\/Application Support\/OpenQian$/);
  });

  it("uses XDG_DATA_HOME on Linux", () => {
    expect(dataDir({ XDG_DATA_HOME: "/data" }, "linux")).toBe("/data/openqian");
  });
});

describe("adoptLegacyData", () => {
  const setup = async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oq-paths-"));
    return { fs, root, dir: path.join(root, "OpenQian"), legacy: path.join(root, "OpenChieng") };
  };

  it("moves a pre-rename database (with WAL files) into the new folder", async () => {
    const { adoptLegacyData } = await import("@/lib/paths");
    const { fs, root, dir, legacy } = await setup();
    fs.mkdirSync(legacy);
    for (const f of ["openchieng.db", "openchieng.db-wal", "openchieng.db-shm"]) fs.writeFileSync(path.join(legacy, f), f);
    expect(adoptLegacyData(dir, legacy)).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(["openqian.db", "openqian.db-shm", "openqian.db-wal"]);
    expect(fs.readFileSync(path.join(dir, "openqian.db"), "utf8")).toBe("openchieng.db");
    expect(fs.existsSync(legacy)).toBe(false);
    fs.rmSync(root, { recursive: true });
  });

  it("renames the file in place when DATA_DIR is used for both", async () => {
    const { adoptLegacyData } = await import("@/lib/paths");
    const { fs, root } = await setup();
    fs.writeFileSync(path.join(root, "openchieng.db"), "x");
    expect(adoptLegacyData(root, root)).toBe(true);
    expect(fs.existsSync(path.join(root, "openqian.db"))).toBe(true);
    fs.rmSync(root, { recursive: true });
  });

  it("never overwrites an existing database", async () => {
    const { adoptLegacyData } = await import("@/lib/paths");
    const { fs, root, dir, legacy } = await setup();
    fs.mkdirSync(dir);
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(dir, "openqian.db"), "new");
    fs.writeFileSync(path.join(legacy, "openchieng.db"), "old");
    expect(adoptLegacyData(dir, legacy)).toBe(false);
    expect(fs.readFileSync(path.join(dir, "openqian.db"), "utf8")).toBe("new");
    expect(adoptLegacyData(path.join(root, "none"), path.join(root, "missing"))).toBe(false);
    fs.rmSync(root, { recursive: true });
  });
});
