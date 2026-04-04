import { join } from "node:path";
import type { Config } from "../types";
import { parseFrontmatter } from "../frontmatter";
import { searchVault } from "./search";
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
        serverInfo: { name: "brain-mcp", version: "1.0.0" },
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
    default:
      return makeError(id, METHOD_NOT_FOUND, `Unknown tool: ${toolName}`);
  }
}

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
  const file = Bun.file(fullPath);

  if (!(await file.exists())) {
    return makeError(id, INVALID_PARAMS, `File not found: ${relPath}`);
  }

  const content = await file.text();
  return makeResponse(id, {
    content: [{ type: "text", text: content }],
  });
}

async function handleListConcepts(
  id: number | string,
  config: Config,
): Promise<JsonRpcResponse> {
  const glob = new Bun.Glob("wiki/**/*.md");
  const concepts: { title: string; path: string }[] = [];

  for await (const path of glob.scan({ cwd: config.vault })) {
    const fullPath = join(config.vault, path);
    const content = await Bun.file(fullPath).text();
    const parsed = parseFrontmatter(content);
    const title = parsed?.frontmatter.title ?? path;
    concepts.push({ title, path });
  }

  const text = JSON.stringify(concepts, null, 2);
  return makeResponse(id, {
    content: [{ type: "text", text }],
  });
}

export async function run(args: string[], config: Config): Promise<void> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line) {
        const response = await handleMessage(line, config);
        if (response) {
          console.log(JSON.stringify(response));
        }
      }
    }
  }
}
