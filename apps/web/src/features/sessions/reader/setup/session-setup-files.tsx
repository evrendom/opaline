import type { SessionSetupFile } from "@rudel/api-routes";
import { skillOfSetupFile } from "@rudel/api-routes/session-context/session-setup-name";
import {
	type Icon,
	IconFileText,
	IconPlug,
	IconRobot,
	IconSparkles,
} from "@tabler/icons-react";

export {
	KIND_LABEL,
	setupName,
	skillOfSetupFile,
} from "@rudel/api-routes/session-context/session-setup-name";

export function setupOwner(file: SessionSetupFile): string {
	if (file.scope === "repository")
		return file.owner.split("/").slice(-2).join("/");
	if (file.scope === "member") return "Personal";
	if (file.scope === "plugin") return file.owner.split("@")[0] ?? file.owner;
	if (file.scope === "harness")
		return file.owner === "codex" ? "Codex" : "Claude Code";
	return "MCP server";
}

export function setupGlyph(file: SessionSetupFile): Icon {
	if (file.scope === "mcp") return IconPlug;
	if (file.scope === "harness") return IconRobot;
	if (file.kind === "skill_body") return IconSparkles;
	return IconFileText;
}

export function setupGroups(
	setup: readonly SessionSetupFile[],
): { files: SessionSetupFile[]; label: string }[] {
	const of = (kinds: readonly string[]) =>
		setup.filter((file) => kinds.includes(file.kind));
	const known = [
		"agents_md",
		"developer",
		"instructions",
		"mcp_instructions",
		"nested_memory",
		"skill_body",
		"system_prompt",
	];
	return [
		{
			files: [
				...of(["instructions", "agents_md", "nested_memory"]),
				...of(["system_prompt", "developer"]),
			],
			label: "Instructions",
		},
		{ files: of(["skill_body"]), label: "Skills" },
		{ files: of(["mcp_instructions"]), label: "MCP servers" },
		{
			files: setup.filter((file) => !known.includes(file.kind)),
			label: "Other",
		},
	].filter((group) => group.files.length > 0);
}

export function findSkillSetupFile(
	setup: readonly SessionSetupFile[],
	name: string,
): SessionSetupFile | null {
	const own = name.split(":").at(-1) ?? name;
	return setup.find((file) => skillOfSetupFile(file) === own) ?? null;
}
