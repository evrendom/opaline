import { absolutePath, callDirectory } from "@rudel/api-routes/call-paths";
import { shortSubagentId } from "@/features/sessions/run-id";
import { mcpTool } from "../model/session-reader-mcp-tool";
import type { SessionReaderStep } from "../model/session-reader-run-steps";
import {
	chipLaneKey,
	shellCommandOf,
} from "../model/session-reader-step-lanes";
import { subagentIdOf } from "../subagents/session-reader-agent-focus";
import { subagentTalkedTo } from "../subagents/session-reader-subagent-done";
import type {
	ContextItem,
	ContextKind,
	ContextPart,
	ContextStep,
} from "./session-reader-context-map";

/** About four characters a token: Claude's and GPT's tokenizers on English
 * and code. */
export const CHARS_PER_TOKEN = 4;

export const tokensOf = (text: string | null | undefined) =>
	Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);

const inputTokens = (step: SessionReaderStep) =>
	step.toolEvent ? tokensOf(JSON.stringify(step.toolEvent.input)) : 0;

const programOf = (lead: string) =>
	(lead.trim().split(/\s+/u)[0] ?? lead).split("/").pop() || lead;

const toolNameOf = (step: SessionReaderStep) =>
	step.toolEvent?.toolName ?? step.name;

const FILE_PART = {
	edit: { key: "files:edit", kind: "edit", label: "Edited files" },
	read: { key: "files:read", kind: "read", label: "Read files" },
	write: { key: "files:write", kind: "write", label: "Written files" },
} as const;

const TOOL_GROUPS: {
	key: string;
	kind?: ContextKind;
	label: string;
	tools: ReadonlySet<string>;
}[] = [
	{
		key: "tools:agents",
		kind: "agent",
		label: "Background control",
		tools: new Set([
			"BashOutput",
			"KillBash",
			"KillShell",
			"TaskOutput",
			"TaskStop",
		]),
	},
	{
		key: "tools:plan",
		label: "Plans & todos",
		tools: new Set([
			"EnterPlanMode",
			"ExitPlanMode",
			"TaskCreate",
			"TaskGet",
			"TaskList",
			"TaskUpdate",
			"TodoRead",
			"TodoWrite",
			"update_plan",
		]),
	},
	{
		key: "tools:ask",
		label: "Questions",
		tools: new Set(["AskUserQuestion", "request_user_input"]),
	},
	{
		key: "tools:web",
		label: "Web",
		tools: new Set(["WebFetch", "WebSearch", "web_search"]),
	},
	{
		key: "tools:wait",
		label: "Waiting",
		tools: new Set([
			"CronCreate",
			"CronDelete",
			"CronList",
			"Monitor",
			"ScheduleWakeup",
		]),
	},
];

const toolGroupOf = (step: SessionReaderStep) => {
	const name = toolNameOf(step);
	return TOOL_GROUPS.find((group) => group.tools.has(name)) ?? null;
};

const FILE_ORDER = ["write", "edit", "read"] as const;

const pathOf = (step: SessionReaderStep, path: string) =>
	absolutePath(path, callDirectory(shellCommandOf(step), ""));

function partOf(
	step: SessionReaderStep,
): (Pick<ContextPart, "key" | "kind" | "label"> & { paths?: string[] }) | null {
	if (step.harness === "member") return YOU_PART;
	if (step.harness === "notification")
		return step.notification?.agent
			? SUBAGENTS_PART
			: {
					key: "background",
					kind: "background",
					label: "Background tasks",
				};
	if (step.harness || step.kind === "ci") return null;
	if (step.kind === "message")
		return { key: "model:messages", kind: "model", label: "Agent messages" };
	if (step.kind === "thinking")
		return { key: "model:thinking", kind: "model", label: "Thinking" };
	if (step.kind === "agent" || SUBAGENT_TOOLS.has(toolNameOf(step)))
		return SUBAGENTS_PART;
	if (step.skill) return SKILLS_PART;
	if (mcpTool(toolNameOf(step)))
		return { key: "mcp", kind: chipLaneKey(step), label: "MCP" };
	const files = step.files ?? [];
	const operation = FILE_ORDER.find((each) =>
		files.some((file) => file.operation === each),
	);
	if (operation)
		return {
			...FILE_PART[operation],
			paths: [
				...new Set(
					files
						.filter((file) => file.operation === operation)
						.map((file) => pathOf(step, file.path)),
				),
			],
		};
	const group =
		step.command?.kind === "wait"
			? (TOOL_GROUPS.find((each) => each.key === "tools:wait") ?? null)
			: toolGroupOf(step);
	if (group)
		return {
			key: group.key,
			kind: group.kind ?? chipLaneKey(step),
			label: group.label,
		};
	if (step.command) {
		const program = programOf(step.command.lead);
		return {
			key: `program:${program}`,
			kind: chipLaneKey(step),
			label: program,
		};
	}
	return {
		key: `tool:${step.name}`,
		kind: chipLaneKey(step),
		label: step.name,
	};
}

export function placeOf(step: SessionReaderStep) {
	const part = partOf(step);
	if (!part) return null;
	return {
		items: itemsOf(step, part.paths).map((item) => item.label),
		key: part.key,
		label: part.label,
	};
}

export const messageLabelOf = (text: string) => firstLine(text);

export const promptLabelOf = (text: string | null | undefined) =>
	firstLine(text) ?? "Your prompt";

export const YOU_KEY = "you";

function firstLine(text: string | null | undefined): string | null {
	const line = text?.trim().split("\n")[0]?.trim();
	if (!line) return null;
	return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

function itemsOf(
	step: SessionReaderStep,
	paths: readonly string[] | undefined,
): { key: string; label: string }[] {
	if (paths && paths.length > 0)
		return paths.map((path) => ({ key: path, label: path }));
	return [itemOf(step)];
}

function itemOf(step: SessionReaderStep): { key: string; label: string } {
	const subagent =
		step.kind === "agent" ? subagentIdOf(step) : subagentTalkedTo(step);
	if (subagent)
		return { key: `agent:${subagent}`, label: subagentName(step, subagent) };
	if (step.harness)
		return {
			key: step.id,
			label: firstLine(step.text) ?? step.name,
		};
	if (!step.command && toolGroupOf(step)) {
		const name = toolNameOf(step);
		return { key: name, label: name };
	}
	if (step.command)
		return {
			key: step.command.chain,
			label: firstLine(step.command.chain) ?? step.name,
		};
	if (step.skill) return { key: step.skill, label: step.skill };
	const mcp = mcpTool(toolNameOf(step));
	if (mcp) {
		const label = `${mcp.server}:${mcp.tool}`;
		return { key: label, label };
	}
	if (
		step.kind === "message" ||
		step.kind === "thinking" ||
		step.kind === "agent"
	)
		return {
			key: step.id,
			label: firstLine(step.detail ?? step.text) ?? step.name,
		};
	const subject = firstLine(step.detail);
	return subject
		? { key: subject, label: subject }
		: { key: step.name, label: step.name };
}

const YOU_PART = { key: "you", kind: "you", label: "Your prompts" } as const;

export const SUBAGENTS_PART = {
	key: "agents",
	kind: "agent",
	label: "Subagents",
} as const;

const SUBAGENT_TOOLS = new Set(["ListAgents", "SendMessage"]);

function subagentName(step: SessionReaderStep, id: string): string {
	const what = step.kind === "agent" ? firstLine(step.detail) : null;
	return [shortSubagentId(id), what].filter(Boolean).join(" · ");
}

const SKILLS_PART = { key: "skills", kind: "skill", label: "Skills" } as const;

const SKILL_BODY = /Base directory for this skill: (\S+)/gu;

function skillBodiesIn(prompt: string): {
	bodies: { name: string; text: string }[];
	text: string;
} {
	const starts = [...prompt.matchAll(SKILL_BODY)];
	const first = starts[0];
	if (first?.index === undefined) return { bodies: [], text: prompt };
	return {
		bodies: starts.map((match, index) => ({
			name: match[1]?.split("/").filter(Boolean).at(-1) ?? "Skill",
			text: prompt.slice(match.index, starts[index + 1]?.index),
		})),
		text: prompt.slice(0, first.index),
	};
}

export function collect(
	prompt: string | readonly string[] | null,
	steps: readonly SessionReaderStep[],
) {
	const byKey = new Map<string, ContextPart>();
	const paths = new Map<string, Set<string>>();
	const things = new Map<string, Map<string, ContextItem>>();
	const add = (
		part: Pick<ContextPart, "key" | "kind" | "label"> & { paths?: string[] },
		tokens: number,
		items: readonly { key: string; label: string }[],
	) => {
		if (tokens <= 0) return;
		for (const path of part.paths ?? [])
			paths.set(part.key, (paths.get(part.key) ?? new Set()).add(path));
		const inPart = things.get(part.key) ?? new Map<string, ContextItem>();
		things.set(part.key, inPart);
		const each = tokens / Math.max(1, items.length);
		for (const item of items) {
			const thing = inPart.get(item.key);
			if (thing) {
				thing.count += 1;
				thing.tokens += each;
			} else
				inPart.set(item.key, { count: 1, label: item.label, tokens: each });
		}
		const { paths: _paths, ...own } = part;
		const had = byKey.get(part.key);
		if (!had) {
			byKey.set(part.key, { ...own, count: 1, tokens });
			return;
		}
		had.tokens += tokens;
		had.count += 1;
	};
	const prompts = typeof prompt === "string" ? [prompt] : (prompt ?? []);
	let promptTokens = 0;
	prompts.forEach((whole, index) => {
		const { bodies, text } = skillBodiesIn(whole);
		promptTokens += tokensOf(whole);
		add(YOU_PART, tokensOf(text), [
			{ key: `prompt:${index}`, label: firstLine(text) ?? "Your prompt" },
		]);
		for (const body of bodies)
			add(SKILLS_PART, tokensOf(body.text), [
				{ key: body.name, label: body.name },
			]);
	});
	const trail: ContextStep[] = [];
	for (const step of steps) {
		const part = partOf(step);
		if (!part) continue;
		const tokens =
			tokensOf(step.text) +
			tokensOf(step.result) +
			inputTokens(step) +
			tokensOf(step.toolEvent?.skillContent?.content);
		const items = itemsOf(step, part.paths);
		add(part, tokens, items);
		const named = things.get(part.key);
		if (tokens > 0)
			trail.push({
				end: step.endMs,
				id: step.id,
				items: items.map((item) => named?.get(item.key)?.label ?? item.label),
				key: part.key,
				start: step.startMs,
				tokens,
				waited: step.backgroundFromMs ?? step.endMs,
				written:
					step.kind === "message" || step.kind === "thinking"
						? step.endMs
						: (step.writtenUntilMs ?? step.startMs),
			});
	}
	const you = byKey.get("you");
	if (you && you.count === 1) you.label = "Your prompt";
	for (const [key, files] of paths) {
		const part = byKey.get(key);
		if (part) part.files = files.size;
	}
	const estimated = [...byKey.values()].sort((a, b) => b.tokens - a.tokens);
	return { estimated, promptTokens, things, trail };
}
