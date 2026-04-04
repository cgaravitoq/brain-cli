import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { die } from "../errors";
import { parseFrontmatter } from "../frontmatter";
import { slugify, formatDate } from "../utils";

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export interface CanvasOptions {
  topic: string;
  depth: number;
}

export interface MatchedArticle {
  path: string; // relative path like "wiki/article-name.md"
  stem: string; // filename without .md, lowercased
}

export interface CanvasNode {
  id: string;
  type: "file";
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: string;
  toSide: string;
}

export interface CanvasJson {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export function parseCanvasArgs(args: string[]): CanvasOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      depth: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  const topic = positionals.join(" ").trim();
  if (!topic) {
    die("canvas requires a topic argument");
  }

  const depthStr = values.depth as string | undefined;
  const depth = depthStr !== undefined ? parseInt(depthStr, 10) : 1;
  if (isNaN(depth) || depth < 0) {
    die("--depth must be a non-negative integer");
  }

  return { topic, depth };
}

export async function findMatchingArticles(
  vault: string,
  topic: string,
): Promise<MatchedArticle[]> {
  const lowerTopic = topic.toLowerCase();
  const matches: MatchedArticle[] = [];
  const glob = new Bun.Glob("**/*.md");

  for await (const relPath of glob.scan({ cwd: vault, absolute: false })) {
    const stem = relPath
      .replace(/\.md$/, "")
      .split("/")
      .pop()!
      .toLowerCase();

    // Check filename match
    if (stem.includes(lowerTopic)) {
      matches.push({ path: relPath, stem });
      continue;
    }

    // Check frontmatter title match
    try {
      const content = await Bun.file(join(vault, relPath)).text();
      const parsed = parseFrontmatter(content);
      if (parsed?.frontmatter.title) {
        const title = parsed.frontmatter.title.toLowerCase();
        if (title.includes(lowerTopic)) {
          matches.push({ path: relPath, stem });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  matches.sort((a, b) => a.path.localeCompare(b.path));
  return matches;
}

export function extractWikilinksFromContent(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, WIKILINK_RE.flags);
  while ((match = re.exec(content)) !== null) {
    links.push(match[1]!);
  }
  return links;
}

export function extractRelatedFromFrontmatter(
  frontmatter: Record<string, string>,
): string[] {
  const raw = frontmatter.related;
  if (!raw) return [];

  // Parse "[a, b, c]" format
  const stripped = raw.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!stripped) return [];

  return stripped.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function buildStemMap(
  vault: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const glob = new Bun.Glob("**/*.md");

  for await (const relPath of glob.scan({ cwd: vault, absolute: false })) {
    const stem = relPath
      .replace(/\.md$/, "")
      .split("/")
      .pop()!
      .toLowerCase();
    map.set(stem, relPath);
  }

  return map;
}

export async function collectNodes(
  vault: string,
  seeds: MatchedArticle[],
  stemMap: Map<string, string>,
  depth: number,
): Promise<Map<number, MatchedArticle[]>> {
  const nodesByDepth = new Map<number, MatchedArticle[]>();
  const visited = new Set<string>();

  // Add seed nodes at depth 0
  const seedArticles: MatchedArticle[] = [];
  for (const seed of seeds) {
    if (!visited.has(seed.path)) {
      visited.add(seed.path);
      seedArticles.push(seed);
    }
  }
  nodesByDepth.set(0, seedArticles);

  // Follow links for each depth level
  for (let d = 0; d < depth; d++) {
    const currentLevel = nodesByDepth.get(d);
    if (!currentLevel || currentLevel.length === 0) break;

    const nextLevel: MatchedArticle[] = [];

    for (const article of currentLevel) {
      try {
        const content = await Bun.file(join(vault, article.path)).text();
        const parsed = parseFrontmatter(content);

        // Get wikilink targets
        const wikilinks = extractWikilinksFromContent(content);

        // Get related from frontmatter
        const related = parsed
          ? extractRelatedFromFrontmatter(parsed.frontmatter)
          : [];

        // Combine all link targets
        const allTargets = [...wikilinks, ...related];

        for (const target of allTargets) {
          const targetStem = target.toLowerCase();
          const resolvedPath = stemMap.get(targetStem);
          if (resolvedPath && !visited.has(resolvedPath)) {
            visited.add(resolvedPath);
            nextLevel.push({
              path: resolvedPath,
              stem: targetStem,
            });
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    if (nextLevel.length > 0) {
      nextLevel.sort((a, b) => a.path.localeCompare(b.path));
      nodesByDepth.set(d + 1, nextLevel);
    }
  }

  return nodesByDepth;
}

export function layoutNodes(
  nodesByDepth: Map<number, MatchedArticle[]>,
): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  let nodeIndex = 0;

  const depthKeys = [...nodesByDepth.keys()].sort((a, b) => a - b);

  for (const d of depthKeys) {
    const articles = nodesByDepth.get(d)!;
    for (let i = 0; i < articles.length; i++) {
      nodes.push({
        id: `node-${nodeIndex}`,
        type: "file",
        file: articles[i]!.path,
        x: i * 500,
        y: d * 400,
        width: 400,
        height: 200,
      });
      nodeIndex++;
    }
  }

  return nodes;
}

export function buildCanvasJson(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): CanvasJson {
  return { nodes, edges };
}

function buildEdges(
  vault: string,
  nodes: CanvasNode[],
  nodesByDepth: Map<number, MatchedArticle[]>,
  stemMap: Map<string, string>,
  linkMap: Map<string, string[]>,
): CanvasEdge[] {
  const edges: CanvasEdge[] = [];
  let edgeIndex = 0;

  // Build a map from file path to node id
  const pathToNodeId = new Map<string, string>();
  for (const node of nodes) {
    pathToNodeId.set(node.file, node.id);
  }

  // Build a set of all node paths for quick lookup
  const nodePaths = new Set(nodes.map((n) => n.file));

  // For each node, check its links and create edges
  for (const node of nodes) {
    const targets = linkMap.get(node.file) ?? [];

    for (const target of targets) {
      const targetStem = target.toLowerCase();
      const resolvedPath = stemMap.get(targetStem);
      if (resolvedPath && nodePaths.has(resolvedPath)) {
        const targetNodeId = pathToNodeId.get(resolvedPath);
        if (targetNodeId && targetNodeId !== node.id) {
          // Avoid duplicate edges
          const edgeKey = `${node.id}->${targetNodeId}`;
          const exists = edges.some(
            (e) => e.fromNode === node.id && e.toNode === targetNodeId,
          );
          if (!exists) {
            edges.push({
              id: `edge-${edgeIndex}`,
              fromNode: node.id,
              toNode: targetNodeId,
              fromSide: "bottom",
              toSide: "top",
            });
            edgeIndex++;
          }
        }
      }
    }
  }

  return edges;
}

export function generateCanvasFilename(
  topic: string,
  date: Date = new Date(),
): string {
  const slug = slugify(topic);
  return `${formatDate(date)}-${slug}.canvas`;
}

export async function run(args: string[], config: Config): Promise<void> {
  const { topic, depth } = parseCanvasArgs(args);
  const { vault } = config;

  // Find matching seed articles
  const seeds = await findMatchingArticles(vault, topic);
  if (seeds.length === 0) {
    die(`no articles matching '${topic}'`);
  }

  // Build stem map for resolving wikilinks
  const stemMap = await buildStemMap(vault);

  // Collect nodes by following links up to depth
  const nodesByDepth = await collectNodes(vault, seeds, stemMap, depth);

  // Build a link map (file path -> list of link targets) for edge creation
  const linkMap = new Map<string, string[]>();
  for (const [, articles] of nodesByDepth) {
    for (const article of articles) {
      try {
        const content = await Bun.file(join(vault, article.path)).text();
        const parsed = parseFrontmatter(content);
        const wikilinks = extractWikilinksFromContent(content);
        const related = parsed
          ? extractRelatedFromFrontmatter(parsed.frontmatter)
          : [];
        linkMap.set(article.path, [...wikilinks, ...related]);
      } catch {
        // Skip files that can't be read
      }
    }
  }

  // Layout nodes
  const canvasNodes = layoutNodes(nodesByDepth);

  // Build edges
  const canvasEdges = buildEdges(vault, canvasNodes, nodesByDepth, stemMap, linkMap);

  // Build canvas JSON
  const canvas = buildCanvasJson(canvasNodes, canvasEdges);

  // Write output
  const filename = generateCanvasFilename(topic);
  const outputDir = join(vault, "output", "canvas");
  const outputPath = join(outputDir, filename);

  await mkdir(outputDir, { recursive: true });
  await Bun.write(outputPath, JSON.stringify(canvas, null, 2));

  const relOutput = join("output", "canvas", filename);
  console.log(
    `Canvas saved: ${relOutput} (${canvas.nodes.length} nodes, ${canvas.edges.length} edges)`,
  );
}
