/**
 * Detection of user-role text that a person did not write.
 *
 * Agent harnesses and workspace tools inject context into user-role messages:
 * Conductor `<system_instruction>`, Claude Code `<system-reminder>` and slash
 * command wrappers, task notifications, Codex environment context and
 * AGENTS.md instructions. A genuine prompt is whatever remains after removing
 * those elements.
 */

/** Wrapper element name (lowercase) to the injected-context subtype it yields. */
const WRAPPER_SUBTYPES: ReadonlyMap<string, string> = new Map([
	["system_instruction", "system_instruction"],
	["system-reminder", "system_reminder"],
	["command-name", "slash_command"],
	["command-message", "slash_command"],
	["command-args", "slash_command"],
	["local-command-stdout", "local_command"],
	["local-command-stderr", "local_command"],
	["local-command-caveat", "local_command"],
	["bash-input", "user_shell"],
	["bash-stdout", "user_shell"],
	["bash-stderr", "user_shell"],
	["task-notification", "task_notification"],
	["subagent_notification", "task_notification"],
	["user-prompt-submit-hook", "hook"],
	["ide_opened_file", "ide_context"],
	["ide_selection", "ide_context"],
	["ide_diagnostics", "ide_context"],
	["new-diagnostics", "ide_context"],
	["environment_context", "environment_context"],
	["recommended_plugins", "environment_context"],
	["collaboration_mode", "environment_context"],
	["permissions instructions", "environment_context"],
	["skills_instructions", "environment_context"],
	["apps_instructions", "environment_context"],
	["user_instructions", "agents_md"],
	["turn_aborted", "interrupt"],
]);

const WRAPPER_ELEMENT_PATTERN = new RegExp(
	`<(${[...WRAPPER_SUBTYPES.keys()]
		.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
		.join("|")})(?:\\s[^>]*)?>[\\s\\S]*?</\\1\\s*>`,
	// No `u` flag: a case-insensitive, unicode-mode backreference silently fails
	// on non-Latin-1 input in some JavaScriptCore releases.
	"gi",
);

// Codex AGENTS.md payload. Case-sensitive so a human's own <instructions> tag
// in a prompt is left alone.
const AGENTS_MD_BODY_PATTERN = /<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gu;
const AGENTS_MD_HEADER_PATTERN = /^# AGENTS\.md instructions[^\n]*(?:\n|$)/gmu;
const INTERRUPT_PATTERN =
	/^\[Request interrupted by user(?: for tool use)?\]$/u;
const SKILL_BODY_PATTERN = /^Base directory for this skill:/u;
const COMPACT_SUMMARY_PATTERN =
	/^This session is being continued from a previous conversation/u;

export interface WrapperAnalysis {
	/** Subtype of the first wrapper found, '' when none. */
	readonly firstSubtype: string;
	/** Text left after removing every wrapper element. Empty for wrapper-only messages. */
	readonly remainder: string;
}

/** Remove injected wrapper elements and report what they were. */
export function stripInjectedWrappers(text: string): WrapperAnalysis {
	let firstSubtype = "";
	const withoutElements = text.replace(
		WRAPPER_ELEMENT_PATTERN,
		(_match, name: string) => {
			if (firstSubtype === "") {
				firstSubtype = WRAPPER_SUBTYPES.get(name.toLowerCase()) ?? "injected";
			}
			return "";
		},
	);
	const withoutBodies = withoutElements.replace(AGENTS_MD_BODY_PATTERN, () => {
		if (firstSubtype === "") firstSubtype = "agents_md";
		return "";
	});
	const withoutHeaders = withoutBodies.replace(AGENTS_MD_HEADER_PATTERN, () => {
		if (firstSubtype === "") firstSubtype = "agents_md";
		return "";
	});
	return { firstSubtype, remainder: withoutHeaders.trim() };
}

export type UserTextClassification =
	| { readonly kind: "prompt"; readonly text: string }
	| { readonly kind: "injected_context"; readonly subtype: string }
	| { readonly kind: "compaction"; readonly subtype: string }
	| { readonly kind: "meta"; readonly subtype: string };

/**
 * Classify the text of one user-role message.
 *
 * `flaggedMeta` is the transcript's own marker (Claude `isMeta`); it always
 * wins because the harness, not the human, produced the message.
 */
export function classifyUserText(
	text: string,
	flags: { readonly compactSummary?: boolean; readonly flaggedMeta?: boolean },
): UserTextClassification {
	if (flags.compactSummary === true) {
		return { kind: "compaction", subtype: "compact_summary" };
	}
	const trimmed = text.trim();
	if (INTERRUPT_PATTERN.test(trimmed)) {
		return { kind: "meta", subtype: "interrupt" };
	}
	if (COMPACT_SUMMARY_PATTERN.test(trimmed)) {
		return { kind: "compaction", subtype: "compact_summary" };
	}
	const { firstSubtype, remainder } = stripInjectedWrappers(trimmed);
	if (firstSubtype === "slash_command") {
		// A typed slash command is tooling syntax, not a prompt boundary.
		return { kind: "injected_context", subtype: "slash_command" };
	}
	if (remainder === "") {
		return {
			kind: "injected_context",
			subtype: firstSubtype || (flags.flaggedMeta ? "meta" : "empty"),
		};
	}
	if (flags.flaggedMeta === true) {
		return {
			kind: "injected_context",
			subtype: SKILL_BODY_PATTERN.test(remainder) ? "skill_body" : "meta",
		};
	}
	if (SKILL_BODY_PATTERN.test(remainder)) {
		return { kind: "injected_context", subtype: "skill_body" };
	}
	return { kind: "prompt", text: remainder };
}
