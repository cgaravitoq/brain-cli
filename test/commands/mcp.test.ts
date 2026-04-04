import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "../helpers";
import { handleMessage } from "../../src/commands/mcp";
import { makeResponse, makeError, PARSE_ERROR, METHOD_NOT_FOUND } from "../../src/mcp/protocol";
import { getToolDefinitions } from "../../src/mcp/tools";

describe("MCP server", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  describe("protocol", () => {
    test("initialize response has correct fields", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });

      const res = await handleMessage(req, vault.config);
      expect(res).not.toBeNull();
      expect(res!.jsonrpc).toBe("2.0");
      expect(res!.id).toBe(1);
      expect(res!.error).toBeUndefined();

      const result = res!.result as Record<string, unknown>;
      expect(result.protocolVersion).toBe("2024-11-05");
      expect(result.capabilities).toEqual({ tools: {} });

      const serverInfo = result.serverInfo as Record<string, unknown>;
      expect(serverInfo.name).toBe("brain-mcp");
      expect(serverInfo.version).toBe("1.0.0");
    });

    test("notifications (no id) return null", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      const res = await handleMessage(req, vault.config);
      expect(res).toBeNull();
    });

    test("invalid JSON returns parse error", async () => {
      const res = await handleMessage("{not valid json", vault.config);
      expect(res).not.toBeNull();
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(PARSE_ERROR);
      expect(res!.error!.message).toBe("Parse error");
      expect(res!.id).toBeNull();
    });

    test("unknown method returns method-not-found error", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "unknown/method",
      });

      const res = await handleMessage(req, vault.config);
      expect(res).not.toBeNull();
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(METHOD_NOT_FOUND);
      expect(res!.id).toBe(42);
    });

    test("invalid request without jsonrpc field returns error", async () => {
      const res = await handleMessage(JSON.stringify({ id: 1, method: "foo" }), vault.config);
      expect(res).not.toBeNull();
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32600);
    });
  });

  describe("tools/list", () => {
    test("returns all 3 tools with correct names", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      const res = await handleMessage(req, vault.config);
      expect(res).not.toBeNull();
      expect(res!.error).toBeUndefined();

      const result = res!.result as { tools: Array<{ name: string }> };
      expect(result.tools).toHaveLength(3);

      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual(["list_concepts", "read_article", "search_wiki"]);
    });

    test("tools have input schemas", async () => {
      const tools = getToolDefinitions();
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.description.length).toBeGreaterThan(0);
      }

      const searchTool = tools.find((t) => t.name === "search_wiki")!;
      expect(searchTool.inputSchema.required).toEqual(["query"]);

      const readTool = tools.find((t) => t.name === "read_article")!;
      expect(readTool.inputSchema.required).toEqual(["path"]);

      const listTool = tools.find((t) => t.name === "list_concepts")!;
      expect(listTool.inputSchema.required).toBeUndefined();
    });
  });

  describe("search_wiki tool", () => {
    test("returns matching results", async () => {
      await Bun.write(
        join(vault.config.vault, "wiki", "agents.md"),
        "---\ntitle: \"Agents\"\ncreated: 2026-04-03\ntags: [wiki]\n---\n\nAgent orchestration pattern\n",
      );

      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_wiki",
          arguments: { query: "orchestration" },
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res).not.toBeNull();
      expect(res!.error).toBeUndefined();

      const result = res!.result as {
        content: Array<{ type: string; text: string }>;
      };
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      const data = JSON.parse(result.content[0]!.text);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].path).toContain("agents.md");
    });

    test("returns empty array for no matches", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_wiki",
          arguments: { query: "nonexistent" },
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res!.error).toBeUndefined();

      const result = res!.result as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toEqual([]);
    });

    test("returns error for missing query", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_wiki",
          arguments: {},
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32602);
    });
  });

  describe("read_article tool", () => {
    test("reads a file by relative path", async () => {
      const content =
        "---\ntitle: \"Test Article\"\ncreated: 2026-04-03\ntags: [wiki]\n---\n\nThis is test content.\n";
      await Bun.write(join(vault.config.vault, "wiki", "test.md"), content);

      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_article",
          arguments: { path: "wiki/test.md" },
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res).not.toBeNull();
      expect(res!.error).toBeUndefined();

      const result = res!.result as {
        content: Array<{ type: string; text: string }>;
      };
      expect(result.content[0]!.text).toBe(content);
    });

    test("rejects path traversal with ..", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_article",
          arguments: { path: "../etc/passwd" },
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32602);
      expect(res!.error!.message).toContain("..");
    });

    test("returns error for nonexistent file", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_article",
          arguments: { path: "wiki/nonexistent.md" },
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32602);
    });

    test("returns error for missing path param", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_article",
          arguments: {},
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(-32602);
    });
  });

  describe("list_concepts tool", () => {
    test("lists wiki files with titles and paths", async () => {
      await Bun.write(
        join(vault.config.vault, "wiki", "agents.md"),
        "---\ntitle: \"Agent Patterns\"\ncreated: 2026-04-03\ntags: [wiki]\n---\n\nContent\n",
      );
      await Bun.write(
        join(vault.config.vault, "wiki", "routing.md"),
        "---\ntitle: \"Routing\"\ncreated: 2026-04-03\ntags: [wiki]\n---\n\nContent\n",
      );

      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_concepts",
          arguments: {},
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res).not.toBeNull();
      expect(res!.error).toBeUndefined();

      const result = res!.result as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0]!.text) as Array<{
        title: string;
        path: string;
      }>;
      expect(data).toHaveLength(2);

      const titles = data.map((d) => d.title).sort();
      expect(titles).toEqual(["Agent Patterns", "Routing"]);

      const paths = data.map((d) => d.path).sort();
      expect(paths).toEqual(["wiki/agents.md", "wiki/routing.md"]);
    });

    test("returns empty array for empty wiki", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_concepts",
          arguments: {},
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res!.error).toBeUndefined();

      const result = res!.result as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toEqual([]);
    });

    test("uses path as title when frontmatter is missing", async () => {
      await Bun.write(
        join(vault.config.vault, "wiki", "no-fm.md"),
        "Just some content without frontmatter\n",
      );

      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_concepts",
          arguments: {},
        },
      });

      const res = await handleMessage(req, vault.config);
      const result = res!.result as {
        content: Array<{ type: string; text: string }>;
      };
      const data = JSON.parse(result.content[0]!.text) as Array<{
        title: string;
        path: string;
      }>;
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe("wiki/no-fm.md");
    });
  });

  describe("unknown tool", () => {
    test("returns error for unknown tool name", async () => {
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "unknown_tool",
          arguments: {},
        },
      });

      const res = await handleMessage(req, vault.config);
      expect(res!.error).toBeDefined();
      expect(res!.error!.code).toBe(METHOD_NOT_FOUND);
    });
  });

  describe("protocol helpers", () => {
    test("makeResponse creates valid response", () => {
      const res = makeResponse(1, { foo: "bar" });
      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.result).toEqual({ foo: "bar" });
      expect(res.error).toBeUndefined();
    });

    test("makeError creates valid error response", () => {
      const res = makeError(1, -32600, "Invalid Request");
      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.error).toEqual({ code: -32600, message: "Invalid Request" });
      expect(res.result).toBeUndefined();
    });
  });
});
