import { parseArgs } from "node:util";
import { readTextFile, writeTextFile, globFiles } from "../fs";
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { die } from "../errors";
import type { Config } from "../types";

export interface ExportOptions {
  format: "json" | "markdown";
  output?: string;
  verbose: boolean;
}

export function parseExportArgs(args: string[]): { options: ExportOptions; paths: string[] } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      format: { type: "string", default: "json" },
      output: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  return {
    options: {
      format: values.format as "json" | "markdown",
      output: values.output,
      verbose: values.verbose ?? false,
    },
    paths: positionals,
  };
}

export async function run(args: string[], config: Config): Promise<void> {
  const { options } = parseExportArgs(args);
  const vault = config.vault;

  if (options.format === "json") {
    await exportJSON(vault, options.verbose);
  } else if (options.format === "markdown") {
    await exportMarkdown(vault, options.output, options.verbose);
  }
}

interface ExportEntry {
  content: string;
  path: string;
}

async function exportJSON(vault: string, verbose: boolean): Promise<void> {
  const wiki: Record<string, ExportEntry> = {};
  const raw: Record<string, ExportEntry> = {};

  // Export wiki articles
  if (verbose) console.error("Exporting wiki...");
  for await (const path of globFiles("wiki/**/*.md", vault)) {
    const fullPath = join(vault, path);
    const content = await readTextFile(fullPath);
    wiki[path] = { content, path };
  }

  // Export raw files
  if (verbose) console.error("Exporting raw files...");
  for await (const path of globFiles("raw/**/*.md", vault)) {
    const fullPath = join(vault, path);
    const content = await readTextFile(fullPath);
    raw[path] = { content, path };
  }

  const output = {
    exportedAt: new Date().toISOString(),
    wiki,
    raw,
  };

  console.log(JSON.stringify(output, null, 2));
}

async function exportMarkdown(vault: string, outputDir: string | undefined, verbose: boolean): Promise<void> {
  if (!outputDir) {
    die("Output directory required for markdown export. Use: --output <path>");
  }

  await mkdir(join(outputDir, "wiki"), { recursive: true });
  await mkdir(join(outputDir, "raw"), { recursive: true });

  if (verbose) console.error("Exporting wiki...");
  for await (const path of globFiles("wiki/**/*.md", vault)) {
    const content = await readTextFile(join(vault, path));
    const outPath = join(outputDir, path);
    await mkdir(dirname(outPath), { recursive: true });
    await writeTextFile(outPath, content);
    if (verbose) console.error(`  Exported: ${path}`);
  }

  if (verbose) console.error("Exporting raw...");
  for await (const path of globFiles("raw/**/*.md", vault)) {
    const content = await readTextFile(join(vault, path));
    const outPath = join(outputDir, path);
    await mkdir(dirname(outPath), { recursive: true });
    await writeTextFile(outPath, content);
    if (verbose) console.error(`  Exported: ${path}`);
  }

  console.log(`Exported to ${outputDir}/`);
}
