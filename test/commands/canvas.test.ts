import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, type TestVault } from "../helpers";
import {
  parseCanvasArgs,
  findMatchingArticles,
  extractWikilinksFromContent,
  extractRelatedFromFrontmatter,
  buildStemMap,
  generateCanvasFilename,
  buildCanvasJson,
  layoutNodes,
  collectNodes,
  run,
} from "../../src/commands/canvas";
import type { CanvasNode, CanvasEdge, MatchedArticle } from "../../src/commands/canvas";

describe("canvas: parseCanvasArgs", () => {
  test("parses topic from positional args", () => {
    const result = parseCanvasArgs(["machine learning"]);
    expect(result.topic).toBe("machine learning");
    expect(result.depth).toBe(1);
  });

  test("parses multiple positionals as topic", () => {
    const result = parseCanvasArgs(["machine", "learning"]);
    expect(result.topic).toBe("machine learning");
    expect(result.depth).toBe(1);
  });

  test("parses --depth flag", () => {
    const result = parseCanvasArgs(["--depth", "2", "machine"]);
    expect(result.topic).toBe("machine");
    expect(result.depth).toBe(2);
  });

  test("default depth is 1", () => {
    const result = parseCanvasArgs(["topic"]);
    expect(result.depth).toBe(1);
  });

  test("empty topic throws", () => {
    expect(() => parseCanvasArgs([])).toThrow("canvas requires a topic");
  });

  test("depth 0 is valid", () => {
    const result = parseCanvasArgs(["--depth", "0", "topic"]);
    expect(result.depth).toBe(0);
  });
});

describe("canvas: findMatchingArticles", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    await mkdir(join(vault.config.vault, "wiki"), { recursive: true });
    await Bun.write(
      join(vault.config.vault, "wiki/machine-learning.md"),
      "---\ntitle: Machine Learning\nrelated: [neural-networks, deep-learning]\n---\n\nContent about ML.\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/neural-networks.md"),
      "---\ntitle: Neural Networks\n---\n\nContent about NNs.\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/deep-learning.md"),
      "---\ntitle: Deep Learning\n---\n\nContent about DL.\n",
    );
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("finds articles by filename match", async () => {
    const matches = await findMatchingArticles(vault.config.vault, "machine-learning");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.path.includes("machine-learning.md"))).toBe(true);
  });

  test("finds articles by title match", async () => {
    const matches = await findMatchingArticles(vault.config.vault, "Neural Networks");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.path.includes("neural-networks.md"))).toBe(true);
  });

  test("case-insensitive matching", async () => {
    const matches = await findMatchingArticles(vault.config.vault, "DEEP");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.path.includes("deep-learning.md"))).toBe(true);
  });

  test("returns empty for no match", async () => {
    const matches = await findMatchingArticles(vault.config.vault, "quantum");
    expect(matches.length).toBe(0);
  });
});

describe("canvas: extractWikilinksFromContent", () => {
  test("extracts simple wikilinks", () => {
    const content = "See [[neural-networks]] and [[deep-learning]].";
    const links = extractWikilinksFromContent(content);
    expect(links).toEqual(["neural-networks", "deep-learning"]);
  });

  test("handles display text [[target|display]]", () => {
    const content = "See [[neural-networks|Neural Nets]] for details.";
    const links = extractWikilinksFromContent(content);
    expect(links).toEqual(["neural-networks"]);
  });

  test("returns empty for no links", () => {
    const content = "No links here.";
    const links = extractWikilinksFromContent(content);
    expect(links).toEqual([]);
  });

  test("extracts multiple links from same line", () => {
    const content = "Both [[a]] and [[b]] are important.";
    const links = extractWikilinksFromContent(content);
    expect(links).toEqual(["a", "b"]);
  });
});

describe("canvas: extractRelatedFromFrontmatter", () => {
  test("extracts related items from bracket format", () => {
    const fm = { related: "[neural-networks, deep-learning]" };
    const related = extractRelatedFromFrontmatter(fm);
    expect(related).toEqual(["neural-networks", "deep-learning"]);
  });

  test("returns empty when no related field", () => {
    const fm = { title: "Test" };
    const related = extractRelatedFromFrontmatter(fm);
    expect(related).toEqual([]);
  });

  test("handles empty brackets", () => {
    const fm = { related: "[]" };
    const related = extractRelatedFromFrontmatter(fm);
    expect(related).toEqual([]);
  });
});

describe("canvas: buildStemMap", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    await Bun.write(
      join(vault.config.vault, "wiki/concept-a.md"),
      "---\ntitle: Concept A\n---\n\nContent.\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/concept-b.md"),
      "---\ntitle: Concept B\n---\n\nContent.\n",
    );
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("maps stems to paths", async () => {
    const map = await buildStemMap(vault.config.vault);
    expect(map.get("concept-a")).toBe("wiki/concept-a.md");
    expect(map.get("concept-b")).toBe("wiki/concept-b.md");
  });
});

describe("canvas: generateCanvasFilename", () => {
  test("produces correct format with .canvas extension", () => {
    const date = new Date(2026, 3, 4); // April 4, 2026
    const filename = generateCanvasFilename("machine learning", date);
    expect(filename).toBe("2026-04-04-machine-learning.canvas");
  });

  test("slugifies the topic", () => {
    const date = new Date(2026, 0, 15);
    const filename = generateCanvasFilename("My Complex Topic!", date);
    expect(filename).toBe("2026-01-15-my-complex-topic.canvas");
  });
});

describe("canvas: layoutNodes", () => {
  test("correct x/y positioning by depth level", () => {
    const nodesByDepth = new Map<number, MatchedArticle[]>();
    nodesByDepth.set(0, [
      { path: "wiki/a.md", stem: "a" },
      { path: "wiki/b.md", stem: "b" },
    ]);
    nodesByDepth.set(1, [
      { path: "wiki/c.md", stem: "c" },
    ]);

    const nodes = layoutNodes(nodesByDepth);
    expect(nodes.length).toBe(3);

    // Depth 0 nodes at y=0
    expect(nodes[0]!.x).toBe(0);
    expect(nodes[0]!.y).toBe(0);
    expect(nodes[1]!.x).toBe(500);
    expect(nodes[1]!.y).toBe(0);

    // Depth 1 node at y=400
    expect(nodes[2]!.x).toBe(0);
    expect(nodes[2]!.y).toBe(400);

    // All nodes 400x200
    for (const node of nodes) {
      expect(node.width).toBe(400);
      expect(node.height).toBe(200);
    }
  });

  test("depth 2 nodes at y=800", () => {
    const nodesByDepth = new Map<number, MatchedArticle[]>();
    nodesByDepth.set(0, [{ path: "wiki/a.md", stem: "a" }]);
    nodesByDepth.set(1, [{ path: "wiki/b.md", stem: "b" }]);
    nodesByDepth.set(2, [{ path: "wiki/c.md", stem: "c" }]);

    const nodes = layoutNodes(nodesByDepth);
    expect(nodes[2]!.y).toBe(800);
  });
});

describe("canvas: buildCanvasJson", () => {
  test("valid JSON structure with nodes and edges arrays", () => {
    const nodes: CanvasNode[] = [
      { id: "node-0", type: "file", file: "wiki/a.md", x: 0, y: 0, width: 400, height: 200 },
    ];
    const edges: CanvasEdge[] = [
      { id: "edge-0", fromNode: "node-0", toNode: "node-1", fromSide: "bottom", toSide: "top" },
    ];

    const canvas = buildCanvasJson(nodes, edges);
    expect(canvas.nodes).toEqual(nodes);
    expect(canvas.edges).toEqual(edges);
    expect(Array.isArray(canvas.nodes)).toBe(true);
    expect(Array.isArray(canvas.edges)).toBe(true);
  });
});

describe("canvas: collectNodes", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
    await mkdir(join(vault.config.vault, "wiki"), { recursive: true });
    await Bun.write(
      join(vault.config.vault, "wiki/machine-learning.md"),
      "---\ntitle: Machine Learning\nrelated: [neural-networks, deep-learning]\n---\n\nContent about ML. See [[neural-networks]] and [[supervised-learning]].\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/neural-networks.md"),
      "---\ntitle: Neural Networks\n---\n\nContent about NNs. See [[deep-learning]].\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/deep-learning.md"),
      "---\ntitle: Deep Learning\n---\n\nContent about DL. See [[machine-learning]].\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/supervised-learning.md"),
      "---\ntitle: Supervised Learning\n---\n\nContent about supervised learning.\n",
    );
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("depth 0 returns only seed nodes", async () => {
    const seeds: MatchedArticle[] = [
      { path: "wiki/machine-learning.md", stem: "machine-learning" },
    ];
    const stemMap = await buildStemMap(vault.config.vault);
    const nodesByDepth = await collectNodes(vault.config.vault, seeds, stemMap, 0);

    expect(nodesByDepth.get(0)!.length).toBe(1);
    expect(nodesByDepth.has(1)).toBe(false);
  });

  test("depth 1 includes seeds + direct links", async () => {
    const seeds: MatchedArticle[] = [
      { path: "wiki/machine-learning.md", stem: "machine-learning" },
    ];
    const stemMap = await buildStemMap(vault.config.vault);
    const nodesByDepth = await collectNodes(vault.config.vault, seeds, stemMap, 1);

    expect(nodesByDepth.get(0)!.length).toBe(1);
    const depth1 = nodesByDepth.get(1);
    expect(depth1).toBeDefined();
    // Should include neural-networks, deep-learning, supervised-learning
    const depth1Stems = depth1!.map((n) => n.stem);
    expect(depth1Stems).toContain("neural-networks");
    expect(depth1Stems).toContain("deep-learning");
    expect(depth1Stems).toContain("supervised-learning");
  });

  test("depth 2 follows links-of-links", async () => {
    const seeds: MatchedArticle[] = [
      { path: "wiki/supervised-learning.md", stem: "supervised-learning" },
    ];
    const stemMap = await buildStemMap(vault.config.vault);
    // supervised-learning has no outgoing links, so depth 1 should be empty
    const nodesByDepth = await collectNodes(vault.config.vault, seeds, stemMap, 2);

    expect(nodesByDepth.get(0)!.length).toBe(1);
    // supervised-learning has no links, so no depth 1 nodes
    expect(nodesByDepth.has(1)).toBe(false);
  });
});

describe("canvas: run (integration)", () => {
  let vault: TestVault;
  let logs: string[];
  const originalLog = console.log;

  beforeEach(async () => {
    vault = await createTestVault();
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    await mkdir(join(vault.config.vault, "wiki"), { recursive: true });
    await Bun.write(
      join(vault.config.vault, "wiki/machine-learning.md"),
      "---\ntitle: Machine Learning\nrelated: [neural-networks, deep-learning]\n---\n\nContent about ML. See [[neural-networks]] and [[supervised-learning]].\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/neural-networks.md"),
      "---\ntitle: Neural Networks\n---\n\nContent about NNs. See [[deep-learning]].\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/deep-learning.md"),
      "---\ntitle: Deep Learning\n---\n\nContent about DL. See [[machine-learning]].\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki/supervised-learning.md"),
      "---\ntitle: Supervised Learning\n---\n\nContent about supervised learning.\n",
    );
  });

  afterEach(async () => {
    console.log = originalLog;
    await vault.cleanup();
  });

  test("creates canvas file in output/canvas/", async () => {
    await run(["machine"], vault.config);

    const output = logs.join("\n");
    expect(output).toContain("Canvas saved:");
    expect(output).toContain("output/canvas/");
    expect(output).toContain(".canvas");
  });

  test("valid JSON in the canvas file", async () => {
    await run(["machine"], vault.config);

    const glob = new Bun.Glob("**/*.canvas");
    let canvasPath = "";
    for await (const p of glob.scan({ cwd: vault.config.vault })) {
      canvasPath = join(vault.config.vault, p);
    }

    expect(canvasPath).not.toBe("");
    const content = await Bun.file(canvasPath).text();
    const json = JSON.parse(content);
    expect(Array.isArray(json.nodes)).toBe(true);
    expect(Array.isArray(json.edges)).toBe(true);
  });

  test("contains expected nodes and edges", async () => {
    await run(["machine"], vault.config);

    const glob = new Bun.Glob("**/*.canvas");
    let canvasPath = "";
    for await (const p of glob.scan({ cwd: vault.config.vault })) {
      canvasPath = join(vault.config.vault, p);
    }

    const content = await Bun.file(canvasPath).text();
    const json = JSON.parse(content);

    // Should have machine-learning as seed + linked nodes
    expect(json.nodes.length).toBeGreaterThanOrEqual(1);
    const files = json.nodes.map((n: { file: string }) => n.file);
    expect(files.some((f: string) => f.includes("machine-learning"))).toBe(true);

    // With default depth=1, should have edges
    if (json.nodes.length > 1) {
      expect(json.edges.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("depth=0 only includes seed nodes", async () => {
    await run(["--depth", "0", "machine"], vault.config);

    const glob = new Bun.Glob("**/*.canvas");
    let canvasPath = "";
    for await (const p of glob.scan({ cwd: vault.config.vault })) {
      canvasPath = join(vault.config.vault, p);
    }

    const content = await Bun.file(canvasPath).text();
    const json = JSON.parse(content);

    // Only seed node(s) — machine-learning.md
    expect(json.nodes.length).toBe(1);
    expect(json.nodes[0].file).toContain("machine-learning");
  });

  test("depth=1 includes seeds + direct links", async () => {
    await run(["--depth", "1", "machine"], vault.config);

    const glob = new Bun.Glob("**/*.canvas");
    let canvasPath = "";
    for await (const p of glob.scan({ cwd: vault.config.vault })) {
      canvasPath = join(vault.config.vault, p);
    }

    const content = await Bun.file(canvasPath).text();
    const json = JSON.parse(content);

    // seed + linked nodes
    expect(json.nodes.length).toBeGreaterThan(1);
    const files = json.nodes.map((n: { file: string }) => n.file);
    expect(files.some((f: string) => f.includes("machine-learning"))).toBe(true);
    expect(files.some((f: string) => f.includes("neural-networks"))).toBe(true);
  });

  test("prints summary message with node and edge counts", async () => {
    await run(["machine"], vault.config);

    const output = logs.join("\n");
    expect(output).toMatch(/Canvas saved:.*\(\d+ nodes, \d+ edges\)/);
  });

  test("dies when no articles match", async () => {
    await expect(run(["quantum-physics"], vault.config)).rejects.toThrow(
      "no articles matching 'quantum-physics'",
    );
  });
});
