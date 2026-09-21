import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentSource = "user" | "project";

export interface AgentFile {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  disableModelInvocation: boolean;
  source: AgentSource;
  filePath: string;
}

export interface AgentFormData {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  disableModelInvocation: boolean;
}

const AGENT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

export function isValidAgentName(name: string): boolean {
  return AGENT_NAME_RE.test(name);
}

export function getUserAgentsDir(): string {
  return join(getAgentDir(), "agents");
}

export function getProjectAgentsDir(cwd: string): string {
  return join(cwd, ".pi", "agents");
}

function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureUserAgentsDir(): string {
  return ensureDir(getUserAgentsDir());
}

function yamlDoubleQuote(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function serializeAgent(data: AgentFormData): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${data.name}`);
  lines.push(`description: ${yamlDoubleQuote(data.description)}`);
  if (data.tools && data.tools.length > 0) lines.push(`tools: ${data.tools.join(",")}`);
  if (data.model) lines.push(`model: ${yamlDoubleQuote(data.model)}`);
  if (data.disableModelInvocation) lines.push("disable-model-invocation: true");
  lines.push("---");
  lines.push(data.systemPrompt);
  return `${lines.join("\n")}\n`;
}

function parseAgentFile(filePath: string, source: AgentSource): AgentFile | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string")
    return null;
  if (!AGENT_NAME_RE.test(frontmatter.name)) return null;

  const toolsRaw = frontmatter.tools;
  const tools =
    typeof toolsRaw === "string"
      ? toolsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : Array.isArray(toolsRaw)
        ? (toolsRaw as unknown[]).filter((t): t is string => typeof t === "string")
        : undefined;

  const disableRaw = frontmatter["disable-model-invocation"];
  const disableModelInvocation =
    disableRaw === true ||
    (typeof disableRaw === "string" && disableRaw.trim().toLowerCase() === "true");

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    tools: tools && tools.length > 0 ? tools : undefined,
    model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
    systemPrompt: body,
    disableModelInvocation,
    source,
    filePath,
  };
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentFile[] {
  const agents: AgentFile[] = [];
  if (!existsSync(dir)) return agents;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const parsed = parseAgentFile(join(dir, entry.name), source);
    if (parsed) agents.push(parsed);
  }
  return agents;
}

/**
 * The agents the user owns, project scope winning over user scope by name.
 *
 * There used to be a third, "builtin" tier: the fork shipped its own subagent
 * extension plus bundled agent definitions. Both are gone (subagents come from
 * the user-installed pi-subagents package) and nothing can be built in any more.
 */
export function listAgents(projectDir?: string): AgentFile[] {
  const byName = new Map<string, AgentFile>();
  for (const agent of loadAgentsFromDir(getUserAgentsDir(), "user")) byName.set(agent.name, agent);
  if (projectDir) {
    for (const agent of loadAgentsFromDir(getProjectAgentsDir(projectDir), "project")) {
      byName.set(agent.name, agent);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function readAgent(name: string, projectDir?: string): AgentFile | undefined {
  return listAgents(projectDir).find((a) => a.name === name);
}

function resolveScopeDir(scope: "user" | "project", projectDir?: string): string {
  if (scope === "project") {
    if (!projectDir) throw new Error("Project directory required for project scope");
    return ensureDir(getProjectAgentsDir(projectDir));
  }
  return ensureUserAgentsDir();
}

export function writeAgent(
  name: string,
  data: AgentFormData,
  scope: "user" | "project" = "user",
  projectDir?: string,
): AgentFile {
  if (!isValidAgentName(name)) throw new Error(`Invalid agent name: ${name}`);
  if (data.name !== name) throw new Error(`Agent name mismatch: ${name} vs ${data.name}`);

  const targetDir = resolveScopeDir(scope, projectDir);
  const targetPath = join(targetDir, `${name}.md`);
  writeFileSync(targetPath, serializeAgent(data), "utf8");

  const parsed = parseAgentFile(targetPath, scope);
  if (!parsed) throw new Error(`Failed to write agent: ${name}`);
  return parsed;
}

export function deleteAgent(
  name: string,
  scope: "user" | "project" = "user",
  projectDir?: string,
): void {
  if (!isValidAgentName(name)) throw new Error(`Invalid agent name: ${name}`);
  const dir = resolveScopeDir(scope, projectDir);
  const filePath = join(dir, `${name}.md`);
  if (!existsSync(filePath)) throw new Error(`Agent not found: ${name}`);
  rmSync(filePath, { force: true });
}
