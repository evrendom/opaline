import type { SessionSetupFile } from "../session-summary-links.js";

export const KIND_LABEL: Record<string, string> = {
	agents_md: "AGENTS.md",
	developer: "Developer message",
	instructions: "Instructions",
	mcp_instructions: "MCP instructions",
	nested_memory: "Loaded in its directory",
	system_prompt: "System prompt",
};

export function setupName(file: SessionSetupFile): string {
	if (file.kind === "skill_body") return skillOfSetupFile(file) ?? file.path;
	if (file.scope === "mcp") return file.owner.replace(/^plugin:/, "");
	if (file.scope === "harness")
		return file.path === "system_prompt_dynamic"
			? "System prompt, per session"
			: (KIND_LABEL[file.kind] ?? file.path);
	return file.path || file.setupFile;
}

export function skillOfSetupFile(file: SessionSetupFile): string | null {
	if (file.kind !== "skill_body") return null;
	return file.path.split("/").filter(Boolean).at(-2) ?? null;
}
