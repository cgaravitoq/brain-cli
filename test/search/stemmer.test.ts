import { describe, test, expect } from "bun:test";
import { stem } from "../../src/search/stemmer";

describe("stemmer", () => {
  test("strips -ation suffix", () => {
    expect(stem("orchestration")).toBe("orchestr");
  });

  test("strips -tion suffix", () => {
    expect(stem("completion")).toBe("comple");
  });

  test("strips -ing suffix and deduplicates consonant", () => {
    expect(stem("running")).toBe("run");
    expect(stem("stopping")).toBe("stop");
    expect(stem("planning")).toBe("plan");
  });

  test("strips -ing suffix without dedup when no doubled consonant", () => {
    expect(stem("walking")).toBe("walk");
    expect(stem("testing")).toBe("test");
  });

  test("strips -ed suffix and deduplicates consonant", () => {
    expect(stem("stopped")).toBe("stop");
    expect(stem("planned")).toBe("plan");
  });

  test("strips -ed suffix without dedup", () => {
    expect(stem("walked")).toBe("walk");
  });

  test("strips -ated suffix", () => {
    expect(stem("orchestrated")).toBe("orchestr");
  });

  test("strips -s suffix", () => {
    expect(stem("patterns")).toBe("pattern");
    expect(stem("agents")).toBe("agent");
  });

  test("strips -ator suffix", () => {
    expect(stem("orchestrator")).toBe("orchestr");
  });

  test("strips -er suffix", () => {
    expect(stem("runner")).toBe("run");
  });

  test("strips -ly suffix", () => {
    expect(stem("quickly")).toBe("quick");
  });

  test("strips -est suffix", () => {
    expect(stem("fastest")).toBe("fast");
  });

  test("strips -ment suffix", () => {
    expect(stem("management")).toBe("manage");
  });

  test("strips -ness suffix", () => {
    expect(stem("darkness")).toBe("dark");
  });

  test("strips -able suffix", () => {
    expect(stem("searchable")).toBe("search");
  });

  test("strips -ible suffix", () => {
    expect(stem("flexible")).toBe("flex");
  });

  test("does not strip if stem would be too short", () => {
    expect(stem("is")).toBe("is");
    expect(stem("as")).toBe("as");
    expect(stem("the")).toBe("the");
  });

  test("returns lowercase", () => {
    expect(stem("Running")).toBe("run");
    expect(stem("ORCHESTRATION")).toBe("orchestr");
  });

  test("same root for related words", () => {
    const root1 = stem("orchestrate");
    const root2 = stem("orchestration");
    expect(root1).toBe(root2);
  });
});
