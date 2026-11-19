import {
	getRawToolInput,
	type SessionGitAction,
	type SessionRunCheck,
	SessionRunCheckSchema,
	type SessionTurn,
	type SessionTurnStepKind,
} from "@rudel/api-routes";
import {
	describeCommand,
	isSearchLead,
	parseShellCommand,
	SEARCH_TOOLS,
} from "@rudel/api-routes/command-identity";

export type TurnStepKind = SessionTurnStepKind;

export type TurnGitAction = SessionGitAction;

const GIT_VALUE_OPTIONS = new Set([
	"-C",
	"-c",
	"--exec-path",
	"--git-dir",
	"--namespace",
	"--work-tree",
]);

function gitSubcommand(words: readonly string[]): string | undefined {
	for (let index = 1; index < words.length; index++) {
		const word = words[index] as string;
		if (GIT_VALUE_OPTIONS.has(word)) index++;
		else if (!word.startsWith("-")) return word;
	}
	return undefined;
}

function gitActionOfWords(words: readonly string[]): TurnGitAction | null {
	const [program, first, second] = words;
	if (program === "git" && gitSubcommand(words) === "commit") return "commit";
	if (program === "gh" && first === "pr") {
		if (second === "create") return "pullRequest";
		if (second === "merge") return "merge";
	}
	return null;
}

export function gitActionsOfTool(
	toolName: string,
	input: Readonly<Record<string, unknown>>,
): TurnGitAction[] {
	const command = shellCommandOf(toolName, input);
	if (command)
		return parseShellCommand(command).flatMap((simple) => {
			const action = gitActionOfWords(simple.words);
			return action ? [action] : [];
		});
	if (/github/iu.test(toolName)) {
		if (/create_pull_request$/u.test(toolName)) return ["pullRequest"];
		if (/merge_pull_request$/u.test(toolName)) return ["merge"];
	}
	return [];
}

const SHELL_COMMAND_KEYS: Readonly<Record<string, string>> = {
	Bash: "command",
	exec_command: "cmd",
};

export function shellCommandOf(
	toolName: string,
	input: Readonly<Record<string, unknown>>,
): string | undefined {
	const key = SHELL_COMMAND_KEYS[toolName];
	const value = key ? getRawToolInput(input)[key] : undefined;
	return typeof value === "string" && value.trim() !== ""
		? value.trim()
		: undefined;
}

const CHECK_KINDS: ReadonlySet<string> = new Set(SessionRunCheckSchema.options);

const checkKindOf = (kind: string | undefined): SessionRunCheck | null =>
	kind !== undefined && CHECK_KINDS.has(kind)
		? (kind as SessionRunCheck)
		: null;

function kindOfCommand(command: string): TurnStepKind | null {
	const described = describeCommand(command);
	if (!described) return null;
	const lead = described.lead;
	if (isSearchLead(lead)) return "search";
	if (checkKindOf(described.kind)) return "verify";
	switch (described.kind) {
		case "git":
			return "git";
		case "github":
			return "github";
		case "files":
		case "read":
		case "wait":
			return null;
		default:
			return "shell";
	}
}

export function checkOfCommand(command: string): SessionRunCheck | null {
	return checkKindOf(describeCommand(command)?.kind);
}

export function kindOfTool(
	toolName: string,
	input: Readonly<Record<string, unknown>>,
): TurnStepKind | null {
	const command = shellCommandOf(toolName, input);
	if (command) return kindOfCommand(command);
	if (SEARCH_TOOLS.has(toolName)) return "search";
	if (toolName.startsWith("mcp__"))
		return /github/iu.test(toolName) ? "github" : "mcp";
	return null;
}

type TraceItem = SessionTurn["responseItems"][number];
type ToolEvent = Extract<
	Extract<TraceItem, { kind: "agent" }>["events"][number],
	{ kind: "tool" }
>;

function* toolEvents(items: readonly TraceItem[]): Generator<ToolEvent> {
	for (const item of items) {
		if (item.kind !== "agent") continue;
		for (const event of item.events) if (event.kind === "tool") yield event;
	}
}

function tally<Key extends string>(
	counts: Partial<Record<Key, number>>,
	key: Key,
) {
	counts[key] = (counts[key] ?? 0) + 1;
}

function tallyGitActions<Key extends string>(
	counts: Partial<Record<Key | TurnGitAction, number>>,
	event: ToolEvent,
) {
	if (event.result?.isError) return;
	for (const action of gitActionsOfTool(event.toolName, event.input))
		tally(counts, action);
}

const anyCounted = <Counts extends object>(counts: Counts) =>
	Object.keys(counts).length > 0 ? counts : undefined;

export type TurnStepCounts = Record<TurnStepKind | TurnGitAction, number>;

const noSteps = (): TurnStepCounts => ({
	commit: 0,
	git: 0,
	github: 0,
	mcp: 0,
	merge: 0,
	pullRequest: 0,
	search: 0,
	shell: 0,
	verify: 0,
});

function counted(counts: TurnStepCounts): Partial<TurnStepCounts> | undefined {
	return anyCounted(
		Object.fromEntries(
			Object.entries(counts).filter(([, count]) => count > 0),
		) as Partial<TurnStepCounts>,
	);
}

export function countGitActions(
	items: readonly TraceItem[],
): Partial<Record<TurnGitAction, number>> | undefined {
	const counts: Partial<Record<TurnGitAction, number>> = {};
	for (const event of toolEvents(items)) tallyGitActions(counts, event);
	return anyCounted(counts);
}

export function countTurnStepKinds(
	turn: SessionTurn,
): Partial<TurnStepCounts> | undefined {
	const counts = noSteps();
	for (const event of toolEvents(turn.responseItems)) {
		const kind = kindOfTool(event.toolName, event.input);
		if (kind) tally(counts, kind);
		tallyGitActions(counts, event);
	}
	return counted(counts);
}
