import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataDir } from "@/lib/paths";

describe("dataDir", () => {
  it("honors DATA_DIR", () => {
    expect(dataDir({ DATA_DIR: "/tmp/oc" }, "darwin")).toBe(path.resolve("/tmp/oc"));
  });

  it("uses Application Support on macOS", () => {
    expect(dataDir({}, "darwin")).toMatch(/Library\/Application Support\/OpenChieng$/);
  });

  it("uses XDG_DATA_HOME on Linux", () => {
    expect(dataDir({ XDG_DATA_HOME: "/data" }, "linux")).toBe("/data/openchieng");
  });
});
