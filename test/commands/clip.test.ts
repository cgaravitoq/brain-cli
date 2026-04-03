import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/clip";

describe("clip command", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("fails with no URL", async () => {
    expect(run([], vault.config)).rejects.toThrow("Usage:");
  });

  test("fails with invalid URL", async () => {
    expect(run(["not-a-url"], vault.config)).rejects.toThrow("http");
  });

  test("fails with unreachable URL", async () => {
    expect(
      run(["https://this-domain-definitely-does-not-exist-12345.example"], vault.config),
    ).rejects.toThrow();
  });
});
