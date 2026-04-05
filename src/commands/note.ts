import { join } from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Config } from "../types";
import { generateFilename } from "../utils";
import { generateFrontmatter } from "../frontmatter";
import { formatDate } from "../utils";
import { ValidationError, FileSystemError } from "../errors";
import { readTextFile, writeTextFile } from "../fs";
import { spawnSyncInherited } from "../spawn";

interface NoteOptions {
  title?: string;
  editor?: boolean;
  dryRun?: boolean;
}

export async function run(
  args: string[],
  config: Config,
  options: NoteOptions = {},
): Promise<void> {
  if (options.editor) {
    return runEditor(config);
  }

  const body = args.join(" ").trim();
  if (!body && !options.title) {
    throw new ValidationError(
      "Usage: brain <text> or brain -t \"Title\" <text> or brain -e",
      "brain \"my quick note\" or brain -e to open editor",
      2,
    );
  }

  const title = options.title || body;

  if (options.dryRun) {
    const filename = generateFilename(title, new Date());
    console.log(`\n📝 Would create: raw/notes/${filename}`);
    console.log(`   Title: ${title || "(untitled)"}`);
    return;
  }

  const now = new Date();
  const filename = generateFilename(title, now);
  const dir = join(config.vault, "raw", "notes");
  const filepath = join(dir, filename);

  await mkdir(dir, { recursive: true });

  const frontmatter = generateFrontmatter({
    title,
    created: formatDate(now),
    tags: ["raw", "unprocessed"],
  });

  const content = options.title
    ? `${frontmatter}\n\n${body}\n`
    : `${frontmatter}\n\n${title}\n`;

  await writeTextFile(filepath, content);
  console.log(`raw/notes/${filename}`);
}

async function runEditor(config: Config): Promise<void> {
  const editor = process.env.EDITOR || "vim";
  const tmpDir = await mkdtemp(join(tmpdir(), "brain-edit-"));
  const tmpFile = join(tmpDir, "brain-note.md");

  try {
    await writeTextFile(tmpFile, "");

    const proc = spawnSyncInherited([editor, tmpFile]);

    if (proc.exitCode !== 0) {
      throw new FileSystemError(`Editor exited with code ${proc.exitCode}`);
    }

    const content = (await readTextFile(tmpFile)).trim();
    if (!content) {
      console.error("Empty note, nothing saved.");
      return;
    }

    const lines = content.split("\n");
    const firstLine = lines[0] ?? "";
    const title = firstLine.replace(/^#\s*/, "").trim() || content.slice(0, 50);
    const body = content;

    const now = new Date();
    const filename = generateFilename(title, now);
    const dir = join(config.vault, "raw", "notes");
    const filepath = join(dir, filename);

    await mkdir(dir, { recursive: true });

    const frontmatter = generateFrontmatter({
      title,
      created: formatDate(now),
      tags: ["raw", "unprocessed"],
    });

    await writeTextFile(filepath, `${frontmatter}\n\n${body}\n`);
    console.log(`raw/notes/${filename}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
