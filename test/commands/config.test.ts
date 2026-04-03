import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/config";

describe("config command", () => {
  let vault: TestVault;
  let logs: string[];
  const originalLog = console.log;

  beforeEach(async () => {
    vault = await createTestVault();
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    await vault.cleanup();
  });

  test("shows current vault path", async () => {
    await run([], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Vault:");
  });

  test("fails with too many arguments", async () => {
    expect(run(["a", "b"], vault.config)).rejects.toThrow();
  });
});
