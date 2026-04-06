export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function getToolDefinitions(): McpTool[] {
  return [
    {
      name: "search_wiki",
      description: "Search the vault for notes matching a query string",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (multiple terms use AND semantics)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "read_article",
      description:
        "Read a file from the vault by its relative path and return its markdown content",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to the file within the vault",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "list_concepts",
      description:
        "List all wiki concept files with their titles and paths",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "vault_stats",
      description:
        "Get vault statistics: wiki article count, raw source count, processed/unprocessed counts",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_unprocessed",
      description:
        "List all unprocessed raw files (notes and articles without status: processed)",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "vault_lint",
      description:
        "Run vault health checks: broken wikilinks, missing frontmatter fields, orphan concepts, and stale unprocessed files. Returns structured JSON with issues grouped by category.",
      inputSchema: {
        type: "object",
        properties: {
          check: {
            type: "string",
            description:
              "Run only a specific check: 'links', 'frontmatter', 'orphans', or 'stale'. Omit to run all checks.",
            enum: ["links", "frontmatter", "orphans", "stale"],
          },
          fix: {
            type: "boolean",
            description:
              "If true, auto-fix broken wikilinks by removing link syntax and keeping display text. Only applies to links check. Default: false.",
          },
        },
      },
    },
  ];
}
