import type { HistoricalSkillSummary } from "@rudel/api-routes";

export function skillDescription(skill: HistoricalSkillSummary): string | null {
	const preview = skill.contentPreview ?? "";
	const frontmatter = /^---\r?\n([\s\S]*?)(?:\r?\n---|$)/u.exec(
		preview.trim(),
	)?.[1];
	if (frontmatter) {
		const lines = frontmatter.split(/\r?\n/u);
		const index = lines.findIndex((line) => /^description\s*:/u.test(line));
		if (index >= 0) {
			const first = (lines[index] ?? "")
				.replace(/^description\s*:\s*/u, "")
				.replace(/^[>|][-+]?\s*$/u, "");
			const rest: string[] = [];
			for (const line of lines.slice(index + 1)) {
				if (!/^\s/u.test(line)) break;
				rest.push(line.trim());
			}
			const text = [first, ...rest]
				.join(" ")
				.replace(/^["']|["']$/gu, "")
				.replace(/\s+/gu, " ")
				.trim();
			if (text) return text;
		}
	}
	const body = preview
		.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "")
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith("#"));
	return body ?? null;
}
