#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
       brain pull               Git pull with rebase
       brain log                Show vault git log
       brain init [path]        Create vault structure
       brain config [path]      View/set vault path
       brain mcp                MCP server (stdio)
       brain lint               Lint vault health
       brain report <topic>    Generate long-form report
       brain slides <topic>     Generate Marp slide deck
       brain chart <topic>      Generate chart with matplotlib
       brain canvas <topic>     Generate Obsidian canvas
       brain completions <sh>   Shell completions (bash/zsh/fish)`;

const KNOWN_COMMANDS = new Set(["clip", "list", "stats", "config", "search", "compile", "ask", "file", "push", "pull", "log", "mcp", "lint", "report", "slides", "chart", "canvas", "completions", "init"]);

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      title: { type: "string", short: "t" },
      editor: { type: "boolean", short: "e" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  if (values.version) {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
    console.log(`brain v${pkg.version}`);
    return;
  }

  const subcommand = positionals[0];

  // Completions: no config needed, handle early
  if (subcommand === "completions") {
    const { parseCompletionsArgs, run: completionsRun } = await import("../src/commands/completions");
    const shell = parseCompletionsArgs(positionals.slice(1));
    completionsRun(shell);
    return;
  }

  // Init: no config needed, handle early
  if (subcommand === "init") {
    const { parseInitArgs, run: initRun } = await import("../src/commands/init");
    const { path } = parseInitArgs(positionals.slice(1));
    await initRun({ path });
    return;
  }

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
      pull: () => import("../src/commands/pull").then((m) => m.run),
      log: () => import("../src/commands/log").then((m) => m.run),
      mcp: () => import("../src/commands/mcp").then((m) => m.run),
      lint: () => import("../src/commands/lint").then((m) => m.run),
      report: () => import("../src/commands/report").then((m) => m.run),
      slides: () => import("../src/commands/slides").then((m) => m.run),
      chart: () => import("../src/commands/chart").then((m) => m.run),
      canvas: () => import("../src/commands/canvas").then((m) => m.run),
    };

    const handler = await commands[subcommand]!();
    const config =
      subcommand === "config"
        ? (await loadStoredConfig()) ?? { vault: "" }
        : await loadConfig();

    // Commands with custom flag parsing need raw args
    const rawArgCommands = new Set(["compile", "ask", "clip", "file", "push", "pull", "log", "mcp", "lint", "report", "slides", "chart", "canvas", "stats", "search", "list"]);
    await handler(rawArgCommands.has(subcommand) ? process.argv.slice(3) : subArgs, config);
    return;
  }

  // Default: note command
  const config = await loadConfig();

  const dryRun = (values["dry-run"] as boolean) ?? false;

  if (values.editor) {
    await noteRun([], config, { editor: true, dryRun });
    return;
  }

  if (values.title || positionals.length > 0) {
    await noteRun(positionals, config, {
      title: values.title as string | undefined,
      dryRun,
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
    if (err.suggestion) {
      console.error(`  hint: ${err.suggestion}`);
    }
    process.exit(err.exitCode);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`brain: ${message}`);
  process.exit(1);
});
