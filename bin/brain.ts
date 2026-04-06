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
       brain pull               Git pull with rebase
       brain log                Show vault git log
       brain init [path]        Create vault structure
       brain doctor             Diagnose vault setup
       brain config [path]      View/set vault path
       brain mcp                MCP server (stdio)
       brain lint               Lint vault health
       brain report <topic>    Generate long-form report
       brain slides <topic>     Generate Marp slide deck
       brain chart <topic>      Generate chart with matplotlib
       brain canvas <topic>     Generate Obsidian canvas
       brain export             Export vault content
       brain completions <sh>   Shell completions (bash/zsh/fish)`;

const KNOWN_COMMANDS = new Set(["clip", "list", "stats", "config", "search", "compile", "ask", "file", "push", "pull", "log", "mcp", "lint", "report", "slides", "chart", "canvas", "export", "completions", "init"]);

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
    const sub = positionals[0];
    if (sub) {
      const { getCommandHelp } = await import("../src/commands/completions");
      const help = getCommandHelp(sub);
      if (help) {
        console.log(help);
        return;
      }
    }
    console.log(USAGE);
    return;
  }

  if (values.version) {
    const pkgPath = new URL("../package.json", import.meta.url).pathname;
    const pkg = await Bun.file(pkgPath).json() as { version: string };
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

  // Doctor: loads its own config, handle early
  if (subcommand === "doctor") {
    const { run: doctorRun } = await import("../src/commands/doctor");
    await doctorRun();
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
      export: () => import("../src/commands/export").then((m) => m.run),
    };

    const handler = await commands[subcommand]!();
    let config;
    if (subcommand === "config") {
      config = (await loadStoredConfig()) ?? { vault: "" };
    } else if (subcommand === "mcp") {
      // MCP must never prompt on stdout — stdin/stdout are the JSON-RPC transport
      const stored = await loadStoredConfig();
      if (!stored) {
        console.error("brain: no vault configured. Run: brain config <path>");
        process.exit(1);
      }
      config = stored;
    } else {
      config = await loadConfig();
    }

    // Commands with custom flag parsing need raw args
    const rawArgCommands = new Set(["compile", "ask", "clip", "file", "push", "pull", "log", "mcp", "lint", "report", "slides", "chart", "canvas", "export", "stats", "search", "list"]);
    await handler(rawArgCommands.has(subcommand) ? process.argv.slice(3) : subArgs, config);
    return;
  }

  // Reject unknown single-word commands that look like subcommands
  if (
    positionals.length === 1 &&
    !values.title &&
    /^[a-z][a-z0-9-]*$/i.test(positionals[0]) &&
    positionals[0].length <= 20
  ) {
    console.error(`brain: unknown command '${positionals[0]}'`);
    console.error(`  hint: run 'brain --help' to see available commands`);
    process.exit(2);
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
