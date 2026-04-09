import { readFileSync } from "fs";
import { join } from "path";
import { config } from "../config.js";

// P3: cache loaded templates/skills in memory. These files are read on every
// turn by analyzer + speaker prompt-creators; the previous implementation
// re-issued a syscall per turn. The cache is module-scoped, so a process
// restart (e.g. Render redeploy) naturally invalidates it.
const fileCache = new Map<string, string>();

export function loadFile(relativePath: string): string {
  const fullPath = join(config.paths.root, relativePath);
  const cached = fileCache.get(fullPath);
  if (cached !== undefined) return cached;
  try {
    const content = readFileSync(fullPath, "utf-8");
    fileCache.set(fullPath, content);
    return content;
  } catch {
    throw new Error(`Failed to load file: ${fullPath}`);
  }
}

export function loadSkillFile(phaseName: string, fileName: string): string {
  return loadFile(join("agent_config", "skills", phaseName, fileName));
}

export function loadPromptTemplate(templateName: string): string {
  return loadFile(join("agent_config", "prompts", templateName));
}

export function populateTemplate(template: string, variables: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }

  // Check for unresolved placeholders
  const unresolved = result.match(/\{\{[a-zA-Z_]+\}\}/g);
  if (unresolved) {
    throw new Error(`Unresolved placeholders in template: ${unresolved.join(", ")}`);
  }

  return result;
}
