import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Config } from "../types";
import { die } from "../errors";
import { parseFrontmatter, updateRawFrontmatter } from "../frontmatter";

export interface FileOptions {
  last: boolean;
  as: "note" | "article";
}

export function parseFileArgs(args: string[]): FileOptions {
  const { values } = parseArgs({
    args,
    options: {
      last: { type: "boolean", default: false },
      as: { type: "string", default: "note" },
    },
    allowPositionals: true,
    strict: false,
  });

  const as = (values.as as string) ?? "note";
  if (as !== "note" && as !== "article") {
    die(`--as must be "note" or "article", got "${as}"`);
  }

  return {
    last: (values.last as boolean) ?? false,
    as: as as "note" | "article",
  };
}

export interface UnfiledOutput {
  /** Relative to vault, e.g. output/asks/2026-04-04-foo.md */
  path: string;
  /** Display name (filename without date prefix and extension) */
  name: string;
  /** YYYY-MM-DD from filename or frontmatter */
  date: string;
  /** Subdirectory type (asks, reports, etc.) */
  type: string;
}

export async function scanUnfiled(vault: string): Promise<UnfiledOutput[]> {
  const outputDir = join(vault, "output");
  const glob = new Bun.Glob("**/*.md");
  const files: UnfiledOutput[] = [];

  try {
    for await (const path of glob.scan({ cwd: outputDir, absolute: false })) {
      const fullPath = join(outputDir, path);
      const content = await Bun.file(fullPath).text();
      const parsed = parseFrontmatter(content);

      if (parsed?.frontmatter.filed === "true") continue;

      const parts = path.split("/");
      const type = parts.length > 1 ? parts[0]! : "other";
      const filename = parts[parts.length - 1]!;
      const nameWithExt = filename.replace(/\.md$/, "");

      const dateMatch = nameWithExt.match(/^(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch?.[1] ?? parsed?.frontmatter.created ?? "";
      const displayName = nameWithExt.replace(/^\d{4}-\d{2}-\d{2}-/, "");

      files.push({
        path: join("output", path),
        name: displayName,
        date,
        type,
      });
    }
  } catch {
    return [];
  }

  files.sort((a, b) => b.date.localeCompare(a.date));
  return files;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const month = months[parseInt(parts[1]!, 10) - 1] ?? parts[1];
  const day = parseInt(parts[2]!, 10);
  return `${month} ${day}`;
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function fileOutput(
  vault: string,
  output: UnfiledOutput,
  targetType: "note" | "article",
): Promise<string> {
  const targetDir = targetType === "article" ? "raw/articles" : "raw/notes";
  const sourceFullPath = join(vault, output.path);
  const content = await Bun.file(sourceFullPath).text();

  const sourceName = output.path.split("/").pop()!;
  const targetPath = join(targetDir, sourceName);
  const targetFullPath = join(vault, targetPath);

  if (await Bun.file(targetFullPath).exists()) {
    die(`target already exists: ${targetPath}`);
  }

  // Build target: preserve content, add status + filed_from
  const targetContent = updateRawFrontmatter(content, {
    status: "unprocessed",
    filed_from: `"${output.path}"`,
  });

  await mkdir(join(vault, targetDir), { recursive: true });
  await Bun.write(targetFullPath, targetContent);

  // Mark original as filed
  const updatedSource = updateRawFrontmatter(content, {
    filed: "true",
    filed_to: `"${targetPath}"`,
  });
  await Bun.write(sourceFullPath, updatedSource);

  return targetPath;
}

export async function run(args: string[], config: Config): Promise<void> {
  const options = parseFileArgs(args);
  const { vault } = config;

  const unfiled = await scanUnfiled(vault);

  if (unfiled.length === 0) {
    console.log("Nothing to file.");
    return;
  }

  let selected: UnfiledOutput;

  if (options.last) {
    selected = unfiled[0]!;
  } else if (unfiled.length === 1) {
    selected = unfiled[0]!;
    const answer = await prompt(
      `File ${selected.name} (${formatDisplayDate(selected.date)}, ${selected.type})? [Y/n] `,
    );
    if (answer.toLowerCase() === "n") {
      return;
    }
  } else {
    console.log("Unfiled outputs:");
    for (let i = 0; i < unfiled.length; i++) {
      const f = unfiled[i]!;
      console.log(`  ${i + 1}. ${f.name} (${formatDisplayDate(f.date)}, ${f.type})`);
    }
    console.log();

    const answer = await prompt(`File which? [1-${unfiled.length}, or q to quit]: `);

    if (answer.toLowerCase() === "q" || answer === "") {
      return;
    }

    const idx = parseInt(answer, 10);
    if (isNaN(idx) || idx < 1 || idx > unfiled.length) {
      die(`invalid selection: ${answer}`);
    }

    selected = unfiled[idx - 1]!;
  }

  const targetPath = await fileOutput(vault, selected, options.as);
  console.log(`Filed → ${targetPath}`);
}
