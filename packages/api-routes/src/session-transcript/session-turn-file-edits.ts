// Shared by browser and server transcript derivation.
type ClaudeToolBlock = {
	input?: Record<string, unknown> | null;
	name?: string | null;
	type?: string;
};

const CLAUDE_MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
	"edit",
	"multiedit",
	"notebookedit",
	"write",
]);

export function addUniqueEditedFiles(
	editedFiles: string[],
	files: readonly string[],
) {
	for (const file of files) {
		const normalizedFile = file.trim();
		if (!normalizedFile || editedFiles.includes(normalizedFile)) {
			continue;
		}

		editedFiles.push(normalizedFile);
	}
}

export function getClaudeMutationFiles(block: ClaudeToolBlock) {
	if (
		block.type !== "tool_use" ||
		!block.name ||
		!CLAUDE_MUTATION_TOOL_NAMES.has(block.name.toLowerCase()) ||
		!block.input
	) {
		return [];
	}

	for (const key of ["file_path", "notebook_path", "path"] as const) {
		const value = block.input[key];
		if (typeof value === "string") {
			return [value];
		}
	}

	return [];
}
