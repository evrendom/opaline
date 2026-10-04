import type { HistoricalSkillSummary } from "@rudel/api-routes";

/**
 * Skills as list_skills and get_repository return them to the model: usage,
 * version count and where they are used. Content previews stay out (some
 * 1,600 characters each); get_skill returns a skill's content.
 */
export function compactSkills(skills: readonly HistoricalSkillSummary[]) {
	return skills.map((skill) => ({
		name: skill.name,
		sessionCount: skill.sessionCount,
		claudeSessionCount: skill.claudeSessionCount,
		codexSessionCount: skill.codexSessionCount,
		versionCount: skill.versionCount ?? null,
		userCount: skill.attribution?.userCount ?? null,
		repoCount: skill.attribution?.repoCount ?? null,
		topRepos: (skill.attribution?.topRepos ?? []).map((repo) => ({
			repo: repo.repoLabel,
			sessionCount: repo.sessionCount,
		})),
	}));
}
