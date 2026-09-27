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
