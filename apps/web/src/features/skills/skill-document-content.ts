import type { HistoricalSkillVersion } from "@rudel/api-routes";

/** Read the inline, scalar, or block-list allowed-tools field from SKILL.md. */
export function getSkillAllowedTools(content: string): string[] {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
		content.trim(),
	)?.[1];
	if (!frontmatter) return [];
	const lines = frontmatter.split(/\r?\n/u);
	const fieldIndex = lines.findIndex((line) =>
		/^allowed-tools\s*:/u.test(line),
	);
	if (fieldIndex < 0) return [];
	const values = [
		lines[fieldIndex]?.replace(/^allowed-tools\s*:[ \t]*/u, "") ?? "",
	];
	for (const line of lines.slice(fieldIndex + 1)) {
		if (/^\S/u.test(line) && !/^- /u.test(line) && !line.startsWith("]")) break;
		values.push(line.replace(/^\s*-\s+/u, ""));
	}
	// Keep policy arguments such as Bash(git diff:*) together, including spaces.
	const declaration = values
		.map((line) => line.replace(/(?:^|\s+)#.*$/u, ""))
		.join(" ");
	if (/^\s*[&*]/u.test(declaration)) return [];
	return [
		...new Set(declaration.match(/[A-Za-z_][\w.*:-]*(?:\([^()]*\))?/gu) ?? []),
	];
}

export function getSkillDocumentContent(content: string): string {
	return content
		.trim()
		.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "")
		.trim();
}

export function getDistinctSkillVersions(
	versions: readonly HistoricalSkillVersion[],
): HistoricalSkillVersion[] {
	const distinct = new Map<string, HistoricalSkillVersion>();
	for (const version of versions) {
		const body = getSkillDocumentContent(version.content).replaceAll(
			"\r\n",
			"\n",
		);
		const previous = distinct.get(body);
		// Claude's historical captures can omit frontmatter. Keep the matching
		// copy with recorded tools when available, without adding another version.
		if (
			!previous ||
			(getSkillAllowedTools(previous.content).length === 0 &&
				getSkillAllowedTools(version.content).length > 0)
		) {
			distinct.set(body, version);
		}
	}
	return [...distinct.values()];
}
