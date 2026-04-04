import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, createFakeExecutable, type TestVault } from "../helpers";
import { generateFrontmatter } from "../../src/frontmatter";
import {
  parseCompileArgs,
  ensureExtractorAgent,
  buildExtractionPrompt,
  buildWritePrompt,
  parseExtractionPlan,
  run,
} from "../../src/commands/compile";
import type {
  UnprocessedFile,
  WikiArticle,
  ExtractionPlan,
} from "../../src/commands/compile";

describe("multi-model compile", () => {
  let vault: TestVault;
  let logs: string[];
  let errors: string[];
  const originalLog = console.log;
  const originalError = console.error;
  const originalClaudeBin = process.env.BRAIN_CLAUDE_BIN;

  beforeEach(async () => {
    vault = await createTestVault();
    logs = [];
    errors = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    console.error = originalError;
    if (originalClaudeBin === undefined) {
      delete process.env.BRAIN_CLAUDE_BIN;
    } else {
      process.env.BRAIN_CLAUDE_BIN = originalClaudeBin;
    }
    await vault.cleanup();
  });

  describe("parseCompileArgs with new flags", () => {
    test("parses --extract-model", () => {
      const opts = parseCompileArgs(["--extract-model", "haiku"]);
      expect(opts.extractModel).toBe("haiku");
      expect(opts.writeModel).toBeNull();
      expect(opts.model).toBe("sonnet");
    });

    test("parses --write-model", () => {
      const opts = parseCompileArgs(["--write-model", "opus"]);
      expect(opts.writeModel).toBe("opus");
      expect(opts.extractModel).toBeNull();
      expect(opts.model).toBe("sonnet");
    });

    test("parses both --extract-model and --write-model", () => {
      const opts = parseCompileArgs([
        "--extract-model", "haiku",
        "--write-model", "opus",
      ]);
      expect(opts.extractModel).toBe("haiku");
      expect(opts.writeModel).toBe("opus");
    });

    test("--model alone keeps extractModel and writeModel null", () => {
      const opts = parseCompileArgs(["--model", "opus"]);
      expect(opts.model).toBe("opus");
      expect(opts.extractModel).toBeNull();
      expect(opts.writeModel).toBeNull();
    });
  });

  describe("ensureExtractorAgent", () => {
    test("creates extractor agent with correct model and read-only tools", async () => {
      const agentPath = await ensureExtractorAgent(vault.config.vault, "haiku");
      const content = await Bun.file(agentPath).text();

      expect(agentPath).toBe(
        join(vault.config.vault, ".claude", "agents", "extractor.md"),
      );
      expect(content).toContain("model: haiku");
      expect(content).toContain("- Read");
      expect(content).toContain("- Glob");
      // Should NOT have write tools
      expect(content).not.toContain("- Write");
      expect(content).not.toContain("- Edit");
      expect(content).not.toContain("- Grep");
      expect(content).toContain("extraction agent");
    });
  });

  describe("buildExtractionPrompt", () => {
    test("includes files and asks for JSON", () => {
      const files: UnprocessedFile[] = [
        { path: "raw/notes/test.md", title: "Test Note" },
      ];
      const prompt = buildExtractionPrompt(files, []);
      expect(prompt).toContain("1 unprocessed file(s)");
      expect(prompt).toContain("`raw/notes/test.md`");
      expect(prompt).toContain("JSON");
    });

    test("includes existing wiki articles", () => {
      const files: UnprocessedFile[] = [
        { path: "raw/notes/test.md", title: "Test Note" },
      ];
      const wikiArticles: WikiArticle[] = [
        { path: "wiki/concepts/existing.md", title: "Existing", tags: "tag1" },
      ];
      const prompt = buildExtractionPrompt(files, wikiArticles);
      expect(prompt).toContain("Existing wiki articles");
      expect(prompt).toContain("wiki/concepts/existing.md");
    });
  });

  describe("buildWritePrompt", () => {
    test("includes extraction plan and files", () => {
      const files: UnprocessedFile[] = [
        { path: "raw/notes/test.md", title: "Test Note" },
      ];
      const plan: ExtractionPlan = {
        extractions: [{
          source: "raw/notes/test.md",
          concepts: [{
            title: "Test",
            wikiPath: "wiki/concepts/test.md",
            keyPoints: ["point1"],
            relatedConcepts: [],
            suggestedTags: ["test"],
          }],
        }],
      };
      const prompt = buildWritePrompt(files, [], plan);
      expect(prompt).toContain("Extraction Plan");
      expect(prompt).toContain('"title": "Test"');
      expect(prompt).toContain("`raw/notes/test.md`");
      expect(prompt).toContain("Follow the extraction plan");
    });
  });

  describe("parseExtractionPlan", () => {
    test("parses valid JSON", () => {
      const json = JSON.stringify({
        extractions: [{
          source: "raw/notes/test.md",
          concepts: [{
            title: "Test",
            wikiPath: "wiki/concepts/test.md",
            keyPoints: ["p1"],
            relatedConcepts: [],
            suggestedTags: ["test"],
          }],
        }],
      });
      const plan = parseExtractionPlan(json);
      expect(plan).not.toBeNull();
      expect(plan!.extractions).toHaveLength(1);
      expect(plan!.extractions[0]!.source).toBe("raw/notes/test.md");
    });

    test("returns null for invalid JSON", () => {
      expect(parseExtractionPlan("not json")).toBeNull();
    });

    test("returns null for JSON without extractions array", () => {
      expect(parseExtractionPlan('{"foo": "bar"}')).toBeNull();
    });

    test("handles JSON with leading/trailing whitespace", () => {
      const json = `  ${JSON.stringify({ extractions: [] })}  `;
      const plan = parseExtractionPlan(json);
      expect(plan).not.toBeNull();
      expect(plan!.extractions).toHaveLength(0);
    });
  });

  describe("run with two-phase", () => {
    async function writeTestNote() {
      const fm = generateFrontmatter({
        title: "Test Note",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "test.md"),
        `${fm}\n\nSome content about testing.\n`,
      );
    }

    async function initGitRepo() {
      Bun.spawnSync(["git", "init"], { cwd: vault.config.vault });
      Bun.spawnSync(["git", "add", "."], { cwd: vault.config.vault });
      Bun.spawnSync(["git", "commit", "-m", "init", "--allow-empty"], { cwd: vault.config.vault });
    }

    test("two-phase runs both agents", async () => {
      await writeTestNote();
      await initGitRepo();

      const extractionJson = JSON.stringify({
        extractions: [{
          source: "raw/notes/test.md",
          concepts: [{
            title: "Test",
            wikiPath: "wiki/concepts/test.md",
            keyPoints: ["point1"],
            relatedConcepts: [],
            suggestedTags: ["test"],
          }],
        }],
      });

      const fakeClaude = await createFakeExecutable(
        "claude",
        `#!/bin/bash
if echo "$@" | grep -q "extractor"; then
  echo '${extractionJson}'
else
  exit 0
fi
`,
      );

      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      try {
        await run(
          ["--extract-model", "haiku", "--write-model", "opus", "--no-push"],
          vault.config,
        );
      } finally {
        await fakeClaude.cleanup();
      }

      // Verify both agent files were created
      const extractorContent = await Bun.file(
        join(vault.config.vault, ".claude", "agents", "extractor.md"),
      ).text();
      expect(extractorContent).toContain("model: haiku");

      const compilerContent = await Bun.file(
        join(vault.config.vault, ".claude", "agents", "compiler.md"),
      ).text();
      expect(compilerContent).toContain("model: opus");

      const output = logs.join("\n");
      expect(output).toContain("Extracting plan");
      expect(output).toContain("Compiling");
      expect(output).toContain("Compilation complete.");
    });

    test("--model alone uses single phase (backward compat)", async () => {
      await writeTestNote();

      const fakeClaude = await createFakeExecutable(
        "claude",
        "#!/bin/bash\nexit 0\n",
      );

      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      try {
        await run(["--model", "opus"], vault.config);
      } finally {
        await fakeClaude.cleanup();
      }

      // Only compiler agent should be created (single-phase)
      const compilerContent = await Bun.file(
        join(vault.config.vault, ".claude", "agents", "compiler.md"),
      ).text();
      expect(compilerContent).toContain("model: opus");

      // Extractor should NOT be created
      const extractorFile = Bun.file(
        join(vault.config.vault, ".claude", "agents", "extractor.md"),
      );
      expect(await extractorFile.exists()).toBe(false);

      const output = logs.join("\n");
      expect(output).toContain("Compiling");
      expect(output).not.toContain("Extracting plan");
    });

    test("extraction failure falls back to single-model compile", async () => {
      await writeTestNote();

      const fakeClaude = await createFakeExecutable(
        "claude",
        `#!/bin/bash
if echo "$@" | grep -q "extractor"; then
  echo 'this is not valid json at all'
else
  exit 0
fi
`,
      );

      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      try {
        await run(
          ["--extract-model", "haiku", "--write-model", "opus", "--no-push"],
          vault.config,
        );
      } finally {
        await fakeClaude.cleanup();
      }

      const errorOutput = errors.join("\n");
      expect(errorOutput).toContain("Warning: extraction failed");

      const output = logs.join("\n");
      expect(output).toContain("Compiling");
      expect(output).toContain("Compilation complete.");

      // Compiler should use write model
      const compilerContent = await Bun.file(
        join(vault.config.vault, ".claude", "agents", "compiler.md"),
      ).text();
      expect(compilerContent).toContain("model: opus");
    });

    test("--dry-run with two-phase only runs extractor", async () => {
      await writeTestNote();

      const extractionJson = JSON.stringify({
        extractions: [{
          source: "raw/notes/test.md",
          concepts: [{
            title: "Test",
            wikiPath: "wiki/concepts/test.md",
            keyPoints: ["point1"],
            relatedConcepts: [],
            suggestedTags: ["test"],
          }],
        }],
      });

      const fakeClaude = await createFakeExecutable(
        "claude",
        `#!/bin/bash
if echo "$@" | grep -q "extractor"; then
  echo '${extractionJson}'
else
  echo "COMPILER SHOULD NOT RUN"
  exit 1
fi
`,
      );

      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      try {
        await run(
          ["--extract-model", "haiku", "--write-model", "opus", "--dry-run"],
          vault.config,
        );
      } finally {
        await fakeClaude.cleanup();
      }

      // Extractor agent should be created
      const extractorContent = await Bun.file(
        join(vault.config.vault, ".claude", "agents", "extractor.md"),
      ).text();
      expect(extractorContent).toContain("model: haiku");

      // Compiler agent should NOT be created (dry-run stops after extraction)
      const compilerFile = Bun.file(
        join(vault.config.vault, ".claude", "agents", "compiler.md"),
      );
      expect(await compilerFile.exists()).toBe(false);

      const output = logs.join("\n");
      expect(output).toContain("Extracting plan");
      expect(output).toContain('"extractions"');
      expect(output).not.toContain("COMPILER SHOULD NOT RUN");
    });
  });
});
