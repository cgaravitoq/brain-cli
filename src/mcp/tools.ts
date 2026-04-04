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
  ];
}
