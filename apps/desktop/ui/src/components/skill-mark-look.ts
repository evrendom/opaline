import { SKILL_MARKS } from "@rudel/api-routes/skill-icon";
import { getSkillIcon } from "@/components/conversation/conversation-skill-icon";

/** A skill's emoji and tint, keyed to its name: what its mark wears on the
 * Opaline chip, wherever the skill shows. */
export function getSkillMarkLook(skill: string) {
	return SKILL_MARKS[getSkillIcon(skill).name];
}
