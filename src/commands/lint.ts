import { parseArgs } from "node:util";
import type { Config } from "../types";
import { die } from "../errors";
import { checkLinks, fixBrokenLinks } from "../lint/links";
import { checkFrontmatter } from "../lint/frontmatter";
import { checkOrphans } from "../lint/orphans";
import { checkStale } from "../lint/stale";

const VALID_CHECKS = new Set(["links", "frontmatter", "orphans", "stale"]);

export async function run(args: string[], config: Config): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      fix: { type: "boolean", default: false },
      check: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  const fix = values.fix as boolean;
  const checkName = values.check as string | undefined;

  if (checkName && !VALID_CHECKS.has(checkName)) {
    die(
      `Unknown check: ${checkName}. Valid checks: ${[...VALID_CHECKS].join(", ")}`,
      2,
    );
  }

  const runAll = !checkName;
  let errors = 0;
  let warnings = 0;
  const sections: string[] = [];

  // Links check
  if (runAll || checkName === "links") {
    const linkIssues = await checkLinks(config.vault);

    if (fix && linkIssues.length > 0) {
      const fixed = await fixBrokenLinks(config.vault, linkIssues);
      sections.push(`Links\n  Fixed ${fixed} broken link(s)`);
    } else if (linkIssues.length > 0) {
      const lines = ["Links"];
      for (const issue of linkIssues) {
        lines.push(
          `  \u2717 ${issue.file}:${issue.line} \u2014 broken link [[${issue.link}]]`,
        );
      }
      sections.push(lines.join("\n"));
      errors += linkIssues.length;
    }
  }

  // Frontmatter check
  if (runAll || checkName === "frontmatter") {
    const fmIssues = await checkFrontmatter(config.vault);
    if (fmIssues.length > 0) {
      const lines = ["Frontmatter"];
      for (const issue of fmIssues) {
        lines.push(
          `  \u2717 ${issue.file} \u2014 missing: ${issue.missing.join(", ")}`,
        );
      }
      sections.push(lines.join("\n"));
      errors += fmIssues.length;
    }
  }

  // Orphans check
  if (runAll || checkName === "orphans") {
    const orphanIssues = await checkOrphans(config.vault);
    if (orphanIssues.length > 0) {
      const lines = ["Orphans"];
      for (const issue of orphanIssues) {
        lines.push(`  ! ${issue.file} \u2014 no inbound links`);
      }
      sections.push(lines.join("\n"));
      warnings += orphanIssues.length;
    }
  }

  // Stale check
  if (runAll || checkName === "stale") {
    const staleIssues = await checkStale(config.vault);
    if (staleIssues.length > 0) {
      const lines = ["Stale"];
      for (const issue of staleIssues) {
        lines.push(
          `  ! ${issue.file} \u2014 ${issue.age} days unprocessed`,
        );
      }
      sections.push(lines.join("\n"));
      warnings += staleIssues.length;
    }
  }

  // Output
  if (sections.length > 0) {
    console.log(sections.join("\n\n"));
    console.log(`\n${errors} error(s), ${warnings} warning(s)`);
  }

  // Exit code: 1 if errors found
  if (errors > 0) {
    process.exit(1);
  }
}
