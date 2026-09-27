import { describe, expect, it } from "vitest";
import { gradeFor, nextMilestone } from "@/lib/treasury";

describe("gradeFor", () => {
  it("grades by share of assets", () => {
    expect(gradeFor(250, 1000).zh).toBe("朱");
    expect(gradeFor(150, 1000).zh).toBe("金");
    expect(gradeFor(60, 1000).zh).toBe("翠");
    expect(gradeFor(20, 1000).zh).toBe("青玉");
    expect(gradeFor(5, 1000).zh).toBe("白玉");
    expect(gradeFor(5, 0).zh).toBe("白玉");
  });
});

describe("nextMilestone", () => {
  it.each([
    [360_167, 400_000, 300_000],
    [12_345, 20_000, 10_000],
    [1_234_567, 2_000_000, 1_000_000],
    [950, 1_000, 900],
  ])("%d → next %d", (nw, target, previous) => {
    expect(nextMilestone(nw)).toMatchObject({ target, previous });
  });

  it("reports progress within the step and nothing for zero or negative", () => {
    expect(nextMilestone(360_000)!.progress).toBeCloseTo(0.6);
    expect(nextMilestone(0)).toBeNull();
    expect(nextMilestone(-5)).toBeNull();
  });
});

describe("stack labels", async () => {
  const { stackLabel, stackColor } = await import("@/lib/treasury");
  it.each([
    [950, "950"],
    [1_140, "1.1K"],
    [12_500, "13K"],
    [512_000, "512K"],
    [1_250_000, "1.3M"],
    [12_000_000, "12M"],
    [-310_000, "310K"],
  ])("%d → %s", (v, label) => expect(stackLabel(v)).toBe(label));

  it("colours like a game inventory", () => {
    expect(stackColor(99_999)).toBe("#ffff00");
    expect(stackColor(100_000)).toBe("#ffffff");
    expect(stackColor(10_000_000)).toBe("#00ff80");
    expect(stackColor(5, true)).toBe("#ff5a4a");
  });
});

describe("Chinese font subset", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  it("covers every Chinese character used in src/", () => {
    const subset = new Set(fs.readFileSync(path.join(process.cwd(), "src/app/fonts/ZCOOLQingKeHuangYou-subset.txt"), "utf8"));
    const missing = new Set<string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !p.includes("__tests__"))
          for (const ch of fs.readFileSync(p, "utf8").match(/[一-鿿]/g) ?? []) if (!subset.has(ch)) missing.add(ch);
      }
    };
    walk(path.join(process.cwd(), "src"));
    // If this fails, regenerate the font subset (see src/app/fonts/README.md).
    expect([...missing]).toEqual([]);
  });
});
