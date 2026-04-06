import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Config } from "../types";
import { parseFrontmatter } from "../frontmatter";
import { readTextFile, fileExists, globFiles } from "../fs";
import { searchVault } from "./search";
import { gatherStats } from "./stats";
import { gatherItems } from "./list";
import { checkLinks, fixBrokenLinks } from "../lint/links";
import { checkFrontmatter } from "../lint/frontmatter";
import { checkOrphans } from "../lint/orphans";
import { checkStale } from "../lint/stale";
import { getToolDefinitions } from "../mcp/tools";
import {
  type JsonRpcResponse,
  makeResponse,
  makeError,
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
} from "../mcp/protocol";

/**
 * Handle a single JSON-RPC message line and return a response,
 * or null for notifications (messages with no id).
 */
export async function handleMessage(
  line: string,
  config: Config,
): Promise<JsonRpcResponse | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return makeError(null, PARSE_ERROR, "Parse error");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("jsonrpc" in parsed) ||
    (parsed as Record<string, unknown>).jsonrpc !== "2.0"
  ) {
    return makeError(null, INVALID_REQUEST, "Invalid Request");
  }

  const msg = parsed as Record<string, unknown>;
  const method = msg.method as string | undefined;
  const id = msg.id as number | string | undefined;

  // Notifications have no id — no response needed
  if (id === undefined) {
    return null;
  }

  if (typeof method !== "string") {
    return makeError(id, INVALID_REQUEST, "Invalid Request");
  }

  switch (method) {
    case "initialize":
      return makeResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "brain-mcp", version: "2.0.0" },
      });

    case "tools/list":
      return makeResponse(id, { tools: getToolDefinitions() });

    case "tools/call":
      return handleToolCall(id, msg.params as Record<string, unknown>, config);

    default:
      return makeError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

async function handleToolCall(
  id: number | string,
  params: Record<string, unknown> | undefined,
  config: Config,
): Promise<JsonRpcResponse> {
  if (!params || typeof params.name !== "string") {
    return makeError(id, INVALID_PARAMS, "Missing tool name");
  }

  const toolName = params.name;
  const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case "search_wiki":
      return handleSearchWiki(id, toolArgs, config);
    case "read_article":
      return handleReadArticle(id, toolArgs, config);
    case "list_concepts":
      return handleListConcepts(id, config);
    case "vault_stats":
      return handleVaultStats(id, config);
    case "list_unprocessed":
      return handleListUnprocessed(id, config);
    case "vault_lint":
      return handleVaultLint(id, toolArgs, config);
    default:
      return makeError(id, METHOD_NOT_FOUND, `Unknown tool: ${toolName}`);
  }
}

// ── Existing tools ──────────────────────────────────────────────

async function handleSearchWiki(
  id: number | string,
  args: Record<string, unknown>,
  config: Config,
): Promise<JsonRpcResponse> {
  if (typeof args.query !== "string" || args.query.trim().length === 0) {
    return makeError(id, INVALID_PARAMS, "Missing required parameter: query");
  }

  const results = await searchVault(config.vault, args.query);
  const text = JSON.stringify(results, null, 2);
  return makeResponse(id, {
    content: [{ type: "text", text }],
  });
}

async function handleReadArticle(
  id: number | string,
  args: Record<string, unknown>,
  config: Config,
): Promise<JsonRpcResponse> {
  if (typeof args.path !== "string" || args.path.trim().length === 0) {
    return makeError(id, INVALID_PARAMS, "Missing required parameter: path");
  }

  const relPath = args.path;

  // Prevent path traversal
  if (relPath.includes("..")) {
    return makeError(id, INVALID_PARAMS, "Path must not contain '..'");
  }

  const fullPath = join(config.vault, relPath);

  if (!(await fileExists(fullPath))) {
    return makeError(id, INVALID_PARAMS, `File not found: ${relPath}`);
  }

  const content = await readTextFile(fullPath);
  return makeResponse(id, {
    content: [{ type: "text", text: content }],
  });
}

async function handleListConcepts(
  id: number | string,
  config: Config,
): Promise<JsonRpcResponse> {
  const concepts: { title: string; path: string }[] = [];

  for await (const path of globFiles("wiki/**/*.md", config.vault)) {
    const fullPath = join(config.vault, path);
    const content = await readTextFile(fullPath);
    const parsed = parseFrontmatter(content);
    const title = parsed?.frontmatter.title ?? path;
    concepts.push({ title, path });
  }

  const text = JSON.stringify(concepts, null, 2);
  return makeResponse(id, {
    content: [{ type: "text", text }],
  });
}

// ── New maintenance tools ───────────────────────────────────────

async function handleVaultStats(
  id: number | string,
  config: Config,
): Promise<JsonRpcResponse> {
  const stats = await gatherStats(config.vault);
  const text = JSON.stringify(
    {
      wiki: stats.wikiCount,
      raw: stats.rawCount,
      processed: stats.processedCount,
      unprocessed: stats.unprocessedCount,
    },
    null,
    2,
  );
  return makeResponse(id, {
    content: [{ type: "text", text }],
  });
}

async function handleListUnprocessed(
  id: number | string,
  config: Config,
): Promise<JsonRpcResponse> {
  const items = await gatherItems(config.vault);
  const text = JSON.stringify(items, null, 2);
  return makeResponse(id, {
    content: [{ type: "text", text }],
  });
}

async function handleVaultLint(
  id: number | string,
  args: Record<string, unknown>,
  config: Config,
): Promise<JsonRpcResponse> {
  const checkName = args.check as string | undefined;
  const validChecks = new Set(["links", "frontmatter", "orphans", "stale"]);

  if (checkName && !validChecks.has(checkName)) {
    return makeError(
      id,
      INVALID_PARAMS,
      `Unknown check: ${checkName}. Valid: ${[...validChecks].join(", ")}`,
    );
  }

  const runAll = !checkName;

  const result: {
    links?: { count: number; issues: Array<{ file: string; link: string; line: number }>; fixed?: number };
    frontmatter?: { count: number; issues: Array<{ file: string; missing: string[] }> };
    orphans?: { count: number; issues: Array<{ file: string }> };
    stale?: { count: number; issues: Array<{ file: string; age: number }> };
    totalErrors: number;
    totalWarnings: number;
  } = { totalErrors: 0, totalWarnings: 0 };

  if (runAll || checkName === "links") {
    const issues = await checkLinks(config.vault);
    const fix = args.fix === true;

    if (fix && issues.length > 0) {
      const fixed = await fixBrokenLinks(config.vault, issues);
      result.links = { count: issues.length, issues, fixed };
    } else {
      result.links = { count: issues.length, issues };
    }
    result.totalErrors += issues.length;
  }

  if (runAll || checkName === "frontmatter") {
    const issues = await checkFrontmatter(config.vault);
    result.frontmatter = { count: issues.length, issues };
    result.totalErrors += issues.length;
  }

  if (runAll || checkName === "orphans") {
    const issues = await checkOrphans(config.vault);
    result.orphans = { count: issues.length, issues };
    result.totalWarnings += issues.length;
  }

  if (runAll || checkName === "stale") {
    const issues = await checkStale(config.vault);
    result.stale = { count: issues.length, issues };
    result.totalWarnings += issues.length;
  }

  const text = JSON.stringify(result, null, 2);
  return makeResponse(id, {
    content: [{ type: "text", text }],
  });
}

export async function run(args: string[], config: Config): Promise<void> {
  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) {
      const response = await handleMessage(trimmed, config);
      if (response) {
        console.log(JSON.stringify(response));
      }
    }
  }
}
