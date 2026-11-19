import type { SessionSetupFile } from "../session-summary-links.js";

export const KIND_LABEL: Record<string, string> = {
	agents_md: "AGENTS.md",
	developer: "Developer message",
	instructions: "Instructions",
	mcp_instructions: "MCP instructions",
	nested_memory: "Loaded in its directory",
	system_prompt: "System prompt",
};

const DEVELOPER_TAG_LABEL: Record<string, string> = {
	collaboration_mode: "Collaboration mode",
	"permissions instructions": "Permissions",
	multi_agent_mode: "Multi-agent mode",
	multi_agent_role: "Multi-agent role",
	turn_aborted: "Interrupted turn notice",
};

function developerName(tag: string): string {
	if (tag === "") return KIND_LABEL.developer ?? "Developer message";
	const words = tag.replace(/[_-]+/gu, " ").trim();
	return (
		DEVELOPER_TAG_LABEL[tag] ??
		`${words.charAt(0).toUpperCase()}${words.slice(1)}`
	);
}

export function setupName(file: SessionSetupFile): string {
	if (file.kind === "skill_body") return skillOfSetupFile(file) ?? file.path;
	if (file.scope === "mcp") return file.owner.replace(/^plugin:/, "");
	if (file.scope === "harness") {
		if (file.path === "system_prompt_dynamic")
			return "System prompt, per session";
		if (file.kind === "developer") return developerName(file.path);
		return KIND_LABEL[file.kind] ?? file.path;
	}
	return file.path || file.setupFile;
}

export function skillOfSetupFile(file: SessionSetupFile): string | null {
	if (file.kind !== "skill_body") return null;
	return file.path.split("/").filter(Boolean).at(-2) ?? null;
}
