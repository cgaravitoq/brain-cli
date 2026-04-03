import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Config } from "../types";
import { generateFilename } from "../utils";
import { generateFrontmatter } from "../frontmatter";
import { formatDate } from "../utils";
import { die } from "../errors";

interface NoteOptions {
  title?: string;
  editor?: boolean;
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
    die("Usage: brain <text> or brain -t \"Title\" <text> or brain -e", 2);
  }

  const title = options.title || body;
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

  await Bun.write(filepath, content);
  console.log(`raw/notes/${filename}`);
}

async function runEditor(config: Config): Promise<void> {
  const editor = process.env.EDITOR || "vim";
  const tmpDir = await mkdtemp(join(tmpdir(), "brain-edit-"));
  const tmpFile = join(tmpDir, "brain-note.md");

  try {
    await Bun.write(tmpFile, "");

    const proc = Bun.spawnSync([editor, tmpFile], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    if (proc.exitCode !== 0) {
      die(`Editor exited with code ${proc.exitCode}`);
    }

    const content = (await Bun.file(tmpFile).text()).trim();
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

    await Bun.write(filepath, `${frontmatter}\n\n${body}\n`);
    console.log(`raw/notes/${filename}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
