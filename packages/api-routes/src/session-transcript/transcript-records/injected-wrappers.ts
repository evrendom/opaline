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
	// The Codex app's page events: what the person opened in its UI, not a prompt.
	["external_codex_apps_open_page", "ui_event"],
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
/**
 * A skill Codex injects when the person names it (`$skill`): its name, the
 * path of its SKILL.md and that file's text, as one user message.
 */
const CODEX_SKILL_BLOCK_PATTERN =
	/^<skill>\n?<name>([^<\n]{1,256})<\/name>\n?<path>([^<\n]{1,4096})<\/path>\n?([\s\S]*?)\n?<\/skill>$/u;

/** A Codex `<skill>` message's skill: its name, SKILL.md path and text. */
export interface CodexSkillBlock {
	readonly name: string;
	readonly path: string;
	readonly text: string;
}

/** The skill a whole user message injects (`<skill><name>…</name><path>…</path>…</skill>`), or undefined. */
export function readCodexSkillBlock(text: string): CodexSkillBlock | undefined {
	const match = CODEX_SKILL_BLOCK_PATTERN.exec(text.trim());
	const name = match?.[1]?.trim();
	const path = match?.[2]?.trim();
	if (match === null || !name || !path) return undefined;
	return { name, path, text: match[3] ?? "" };
}
const COMPACT_SUMMARY_PATTERN =
	/^This session is being continued from a previous conversation/u;

/** A parent agent's message to a subagent that was working (SendMessage). */
export const COORDINATOR_MESSAGE_PATTERN =
	/^The coordinator sent a message while you were working:/u;

/**
 * Harness texts Claude Code flags as meta, by how they open: the subtype
 * each gets (parser 11), so a reader can place and count them.
 */
const HARNESS_TEXT_SUBTYPES: readonly (readonly [RegExp, string])[] = [
	[
		/^\[SYSTEM NOTIFICATION - NOT USER INPUT\][\s\S]*<task-notification>/u,
		"task_notification",
	],
	[/^\[Image: (?:source: |original \d)/u, "image_metadata"],
	[/^Your response above was cut off mid-stream/u, "stream_recovery"],
	[
		/^Your response above was stopped by a safety classifier/u,
		"safety_recovery",
	],
	[COORDINATOR_MESSAGE_PATTERN, "coordinator_message"],
];

export interface WrapperAnalysis {
	/** Subtype of the first wrapper found, '' when none. */
	readonly firstSubtype: string;
	/** The removed wrapper elements and AGENTS.md payloads, in order, '\n'-joined. */
	readonly injected: string;
	/** Text left after removing every wrapper element. Empty for wrapper-only messages. */
	readonly remainder: string;
}

/** Remove injected wrapper elements and report what they were. */
export function stripInjectedWrappers(text: string): WrapperAnalysis {
	let firstSubtype = "";
	const injected: string[] = [];
	const withoutElements = text.replace(
		WRAPPER_ELEMENT_PATTERN,
		(match, name: string) => {
			if (firstSubtype === "") {
				firstSubtype = WRAPPER_SUBTYPES.get(name.toLowerCase()) ?? "injected";
			}
			injected.push(match);
			return "";
		},
	);
	const withoutHeaders = withoutElements.replace(
		AGENTS_MD_HEADER_PATTERN,
		(match) => {
			if (firstSubtype === "") firstSubtype = "agents_md";
			injected.push(match.trimEnd());
			return "";
		},
	);
	const withoutBodies = withoutHeaders.replace(
		AGENTS_MD_BODY_PATTERN,
		(match) => {
			if (firstSubtype === "") firstSubtype = "agents_md";
			injected.push(match);
			return "";
		},
	);
	return {
		firstSubtype,
		injected: injected.join("\n"),
		remainder: withoutBodies.trim(),
	};
}

export type UserTextClassification =
	| {
			readonly kind: "prompt";
			readonly text: string;
			/**
			 * Wrapper elements removed from around the prompt ('' when none): the
			 * instructions the agent saw with it, kept as their own record.
			 */
			readonly injected: string;
			readonly injectedSubtype: string;
	  }
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
	if (readCodexSkillBlock(trimmed) !== undefined) {
		return { kind: "injected_context", subtype: "skill_body" };
	}
	const { firstSubtype, injected, remainder } = stripInjectedWrappers(trimmed);
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
			subtype: SKILL_BODY_PATTERN.test(remainder)
				? "skill_body"
				: harnessTextSubtype(remainder),
		};
	}
	if (SKILL_BODY_PATTERN.test(remainder)) {
		return { kind: "injected_context", subtype: "skill_body" };
	}
	return {
		kind: "prompt",
		text: remainder,
		injected,
		injectedSubtype: firstSubtype,
	};
}

function harnessTextSubtype(text: string): string {
	for (const [pattern, subtype] of HARNESS_TEXT_SUBTYPES)
		if (pattern.test(text)) return subtype;
	return "meta";
}
