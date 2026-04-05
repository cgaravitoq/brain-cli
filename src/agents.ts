import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { writeTextFile } from "./fs";

export interface AgentDefinition {
  name: string;
  systemPrompt: string;
  tools: string[];
}

/**
 * Create (or overwrite) a Claude agent file in the vault's .claude/agents/ directory.
 * Returns the absolute path to the agent file.
 */
export async function ensureAgent(
  vault: string,
  agentDef: AgentDefinition,
  model: string,
): Promise<string> {
  const agentDir = join(vault, ".claude", "agents");
  const agentPath = join(agentDir, `${agentDef.name}.md`);

  const toolList = agentDef.tools.map((t) => `  - ${t}`).join("\n");
  const content = `---
model: ${model}
tools:
${toolList}
---

${agentDef.systemPrompt}`;

  await mkdir(agentDir, { recursive: true });
  await writeTextFile(agentPath, content);

  return agentPath;
}
