import { readFileSync } from "fs";
import { join } from "path";
import { config } from "../config.js";

export function loadFile(relativePath: string): string {
  const fullPath = join(config.paths.root, relativePath);
  try {
    return readFileSync(fullPath, "utf-8");
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
