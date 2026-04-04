#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { CLIError } from "../src/errors";
import { loadConfig, loadStoredConfig } from "../src/config";
import { run as noteRun } from "../src/commands/note";
import type { CommandHandler } from "../src/types";

const USAGE = `Usage: brain <text>           Quick capture
       brain -t "Title" <text> Note with title
       brain -e                 Open editor
       brain clip <url>         Save article
       brain list               List unprocessed
       brain stats              Vault stats
       brain search <query>     Search vault
       brain compile            Compile raw → wiki
       brain ask <question>     Query the wiki
       brain file               File output → raw
       brain push               Git add, commit & push
       brain config [path]      View/set vault path`;

const KNOWN_COMMANDS = new Set(["clip", "list", "stats", "config", "search", "compile", "ask", "file", "push"]);

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      title: { type: "string", short: "t" },
      editor: { type: "boolean", short: "e" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  if (values.version) {
    const pkg = await Bun.file(
      new URL("../package.json", import.meta.url),
    ).json();
    console.log(`brain v${pkg.version}`);
    return;
  }

  const subcommand = positionals[0];

  // Subcommand routing
  if (subcommand && KNOWN_COMMANDS.has(subcommand)) {
    const subArgs = positionals.slice(1);

    const commands: Record<string, () => Promise<CommandHandler>> = {
      clip: () => import("../src/commands/clip").then((m) => m.run),
      list: () => import("../src/commands/list").then((m) => m.run),
      stats: () => import("../src/commands/stats").then((m) => m.run),
      config: () => import("../src/commands/config").then((m) => m.run),
      search: () => import("../src/commands/search").then((m) => m.run),
      compile: () => import("../src/commands/compile").then((m) => m.run),
      ask: () => import("../src/commands/ask").then((m) => m.run),
      file: () => import("../src/commands/file").then((m) => m.run),
      push: () => import("../src/commands/push").then((m) => m.run),
    };

    const handler = await commands[subcommand]!();
    const config =
      subcommand === "config"
        ? (await loadStoredConfig()) ?? { vault: "" }
        : await loadConfig();

    // Commands with custom flag parsing need raw args
    const rawArgCommands = new Set(["compile", "ask", "file", "push", "search"]);
    await handler(rawArgCommands.has(subcommand) ? Bun.argv.slice(3) : subArgs, config);
    return;
  }

  // Default: note command
  const config = await loadConfig();

  if (values.editor) {
    await noteRun([], config, { editor: true });
    return;
  }

  if (values.title || positionals.length > 0) {
    await noteRun(positionals, config, {
      title: values.title as string | undefined,
    });
    return;
  }

  // No args at all
  console.error(USAGE);
  process.exit(2);
}

main().catch((err: unknown) => {
  if (err instanceof CLIError) {
    console.error(`brain: ${err.message}`);
    process.exit(err.exitCode);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`brain: ${message}`);
  process.exit(1);
});
