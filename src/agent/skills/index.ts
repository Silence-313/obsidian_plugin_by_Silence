// ── Skills Barrel ────────────────────────────────────────────
// Central export for all skills and the registry.

export { SkillRegistry, type Skill, type SkillContext, type SkillResult, type SkillExecutionRecord } from "./skill_registry";
export { getCurrentLocationSkill } from "./get_current_location";
export { readLocalFileSkill } from "./read_local_file";

import { SkillRegistry } from "./skill_registry";
import { getCurrentLocationSkill } from "./get_current_location";
import { readLocalFileSkill } from "./read_local_file";

/**
 * Create a SkillRegistry pre-loaded with all default skills.
 */
export function createDefaultSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registry.register(getCurrentLocationSkill);
  registry.register(readLocalFileSkill);
  return registry;
}
