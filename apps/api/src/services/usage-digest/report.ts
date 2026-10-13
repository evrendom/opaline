import { MODEL_REGISTRY } from "@rudel/api-routes/model-registry";
import type {
	DigestFrustration,
	DigestNumbers,
	DigestSection,
	DigestShare,
	DigestTeamSection,
} from "@rudel/api-routes/usage-digest-email";
import { addDays, type DigestPeriod } from "./schedule.js";

/**
 * One member's runs of one session on one day, for one agent, repository
 * and model, summed: the rows the digest query returns. Receipt-only rows
 * (usage no run claims) carry cost and no runs.
 */
export interface DigestRow {
	user_id: string;
	session_id: string;
	day: string;
	agent: string;
	repository: string;
	model: string;
	runs: number;
	prompts: number;
	active_minutes: number;
	cost_usd: number;
	tool_calls: number;
	failed_calls: number;
	interrupts: number;
	compactions: number;
	api_errors_known_runs: number;
	api_errors: number;
	cache_read_tokens: number;
	/** Active minutes of the longest run among the row's runs. */
	longest_run_minutes: number;
	input_tokens: number;
	/** Subagents the row's runs launched, and the active minutes of subagent runs. */
	subagent_launches: number;
	subagent_minutes: number;
	subagent_runs: number;
	subagent_cost_usd: number;
	subagent_tool_calls: number;
	subagent_failed_calls: number;
	/** Runs that ended in an error, tool calls that timed out, refusals. */
	turn_errors: number;
	timeouts: number;
	refusals: number;
}

/** Uses of one skill, slash command or subagent type by one member in the period. */
export interface ToolboxRow {
	user_id: string;
	kind: "skill" | "command" | "subagent";
	name: string;
	uses: number;
}

/** One session's language signals (rudel.session_language_signals) and its title. */
export interface FrustrationRow {
	user_id: string;
	session_id: string;
	day: string;
	negatives: number;
	swears: number;
	apologies: number;
	phrases: Record<string, number>;
	title: string | null;
	repository: string;
}

export interface DigestReport {
	/** Members with a run in the period, by user id. */
	members: Map<string, DigestSection>;
	team: DigestTeamSection;
}

const AGENT_LABELS: Record<string, string> = {
	claude_code: "Claude Code",
	codex: "Codex",
};
const TOP = 3;
const TOOLBOX = 6;

/**
 * A repository key as people say it: `owner/repo` for a git remote, the last
 * folder of a project path (never the path itself, which names the person's
 * home directory), and "Other" when the session recorded none.
 */
export function repositoryLabel(repository: string): string {
	const key = repository
		.trim()
		.replace(/\.git$/u, "")
		.replace(/\/+$/u, "");
	if (!key) return "Other";
	const remote =
		/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?[^/:]+\.[a-z]{2,}[:/](.+)$/iu.exec(key);
	if (remote?.[1]) return remote[1].split("/").slice(-2).join("/");
	if (key.startsWith("/") || /^[a-z]:\\/iu.test(key))
		return key.split(/[\\/]/u).filter(Boolean).at(-1) ?? "Other";
	return key;
}

export function modelLabel(model: string): string {
	return MODEL_REGISTRY[model]?.displayName ?? model;
}

export function modelProvider(model: string): "anthropic" | "openai" | null {
	const lab = MODEL_REGISTRY[model]?.lab;
	if (lab === "anthropic" || /claude|opus|sonnet|haiku|fable/iu.test(model))
		return "anthropic";
	if (lab === "openai" || /gpt|codex|^o\d/iu.test(model)) return "openai";
	return null;
}

const FRUSTRATION_PHRASES = 5;
const FRUSTRATION_SESSIONS = 3;

function frustration(
	current: readonly FrustrationRow[],
	previous: readonly FrustrationRow[],
): DigestFrustration {
	const moments = (row: FrustrationRow) => row.negatives + row.swears;
	const phrases = new Map<string, number>();
	for (const row of current)
		for (const [text, count] of Object.entries(row.phrases))
			phrases.set(text, (phrases.get(text) ?? 0) + count);
	return {
		moments: current.reduce((sum, row) => sum + moments(row), 0),
		previousMoments: previous.reduce((sum, row) => sum + moments(row), 0),
		swears: current.reduce((sum, row) => sum + row.swears, 0),
		apologies: current.reduce((sum, row) => sum + row.apologies, 0),
		phrases: [...phrases]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, FRUSTRATION_PHRASES)
			.map(([text, count]) => ({ text, count })),
		sessions: current
			.filter((row) => moments(row) > 0)
			.sort((a, b) => moments(b) - moments(a) || a.day.localeCompare(b.day))
			.slice(0, FRUSTRATION_SESSIONS)
			.map((row) => ({
				title: row.title?.trim() || repositoryLabel(row.repository),
				day: row.day,
				moments: moments(row),
			})),
	};
}

function numbers(rows: readonly DigestRow[]): DigestNumbers {
	const sessions = new Set<string>();
	let apiKnown = 0;
	const total: DigestNumbers = {
		sessions: 0,
		prompts: 0,
		activeMinutes: 0,
		costUsd: 0,
		runs: 0,
		toolCalls: 0,
		failedCalls: 0,
		interrupts: 0,
		compactions: 0,
		apiErrors: 0,
		cacheReadTokens: 0,
		longestRunMinutes: 0,
		inputTokens: 0,
		turnErrors: 0,
		timeouts: 0,
		refusals: 0,
	};
	for (const row of rows) {
		if (row.runs > 0) sessions.add(`${row.user_id}\u0000${row.session_id}`);
		total.prompts += row.prompts;
		total.activeMinutes += row.active_minutes;
		total.costUsd += row.cost_usd;
		total.runs += row.runs;
		total.toolCalls += row.tool_calls;
		total.failedCalls += row.failed_calls;
		total.interrupts += row.interrupts;
		total.compactions += row.compactions;
		apiKnown += row.api_errors_known_runs;
		total.apiErrors = (total.apiErrors ?? 0) + row.api_errors;
		total.cacheReadTokens += row.cache_read_tokens;
		total.longestRunMinutes = Math.max(
			total.longestRunMinutes,
			row.longest_run_minutes,
		);
		total.inputTokens += row.input_tokens;
		total.turnErrors += row.turn_errors;
		total.timeouts += row.timeouts;
		total.refusals += row.refusals;
	}
	total.sessions = sessions.size;
	if (apiKnown === 0) total.apiErrors = null;
	return total;
}

/** The largest groups by `measure`, each with its share of the whole. */
function top(
	rows: readonly DigestRow[],
	key: (row: DigestRow) => string | null,
	measure: (row: DigestRow) => number,
	limit = TOP,
): DigestShare[] {
	const groups = new Map<string, number>();
	let whole = 0;
	for (const row of rows) {
		const value = measure(row);
		whole += value;
		const label = key(row);
		if (label !== null) groups.set(label, (groups.get(label) ?? 0) + value);
	}
	return [...groups]
		.filter(([, value]) => value > 0)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit)
		.map(([label, value]) => ({
			label,
			value,
			share: whole ? value / whole : 0,
		}));
}

function subagentNumbers(rows: readonly DigestRow[]) {
	const sum = (pick: (row: DigestRow) => number) =>
		rows.reduce((total, row) => total + pick(row), 0);
	return {
		launches: sum((row) => row.subagent_launches),
		minutes: sum((row) => row.subagent_minutes),
		runs: sum((row) => row.subagent_runs),
		costUsd: sum((row) => row.subagent_cost_usd),
		toolCalls: sum((row) => row.subagent_tool_calls),
		failedCalls: sum((row) => row.subagent_failed_calls),
	};
}

function ranked(rows: readonly ToolboxRow[], limit: number) {
	const uses = new Map<string, number>();
	for (const row of rows)
		uses.set(row.name, (uses.get(row.name) ?? 0) + row.uses);
	return [...uses]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit)
		.map(([name, count]) => ({ name, uses: count }));
}

function section(
	current: readonly DigestRow[],
	previous: readonly DigestRow[],
	period: DigestPeriod,
	toolbox: readonly ToolboxRow[],
	signals: {
		current: readonly FrustrationRow[];
		previous: readonly FrustrationRow[];
	} | null,
): DigestSection {
	const providers = new Map<string, "anthropic" | "openai" | null>();
	for (const row of current)
		if (row.model)
			providers.set(modelLabel(row.model), modelProvider(row.model));
	const kinds = new Map<string, "skill" | "command">();
	for (const row of toolbox)
		if (row.kind !== "subagent") kinds.set(row.name, row.kind);
	return {
		current: numbers(current),
		previous: numbers(previous),
		days:
			period.kind === "weekly"
				? Array.from({ length: 7 }, (_, index) => {
						const day = addDays(period.start, index);
						return current
							.filter((row) => row.day === day)
							.reduce((sum, row) => sum + row.active_minutes, 0);
					})
				: null,
		repositories: top(
			current,
			(row) => repositoryLabel(row.repository),
			(row) => row.active_minutes,
		),
		agents: top(
			current,
			(row) => AGENT_LABELS[row.agent] ?? row.agent,
			(row) => row.runs,
		),
		models: top(
			current,
			// Placeholders such as "<synthetic>" name no model.
			(row) =>
				row.model && !row.model.startsWith("<") ? modelLabel(row.model) : null,
			(row) => row.runs,
		).map((share) => ({
			...share,
			provider: providers.get(share.label) ?? null,
		})),
		toolbox: ranked(
			toolbox.filter((row) => row.kind !== "subagent"),
			TOOLBOX,
		).map((item) => ({ ...item, kind: kinds.get(item.name) ?? "skill" })),
		subagents: {
			current: subagentNumbers(current),
			previous: subagentNumbers(previous),
			types: ranked(
				toolbox.filter((row) => row.kind === "subagent"),
				TOP,
			),
		},
		frustration: signals
			? frustration(signals.current, signals.previous)
			: null,
	};
}

const activeMembers = (rows: readonly DigestRow[]) =>
	new Set(rows.filter((row) => row.runs > 0).map((row) => row.user_id)).size;

/**
 * Every member's section and the workspace's, from the period's rows and the
 * comparison period's. A member appears only with a run in the period.
 */
export function buildDigestReport(
	rows: readonly DigestRow[],
	toolbox: readonly ToolboxRow[],
	signals: readonly FrustrationRow[],
	period: DigestPeriod,
): DigestReport {
	const inCurrent = (row: { day: string }) =>
		row.day >= period.start && row.day < period.end;
	const inPrevious = (row: { day: string }) =>
		row.day >= period.previousStart && row.day < period.previousEnd;
	const current = rows.filter(inCurrent);
	const previous = rows.filter(inPrevious);
	const members = new Map<string, DigestSection>();
	const active = new Set(
		current.filter((row) => row.runs > 0).map((row) => row.user_id),
	);
	for (const userId of active) {
		const mine = (row: { user_id: string }) => row.user_id === userId;
		members.set(
			userId,
			section(
				current.filter(mine),
				previous.filter(mine),
				period,
				toolbox.filter(mine),
				{
					current: signals.filter((row) => mine(row) && inCurrent(row)),
					previous: signals.filter((row) => mine(row) && inPrevious(row)),
				},
			),
		);
	}
	return {
		members,
		team: {
			...section(current, previous, period, [], null),
			activeMembers: activeMembers(current),
			previousActiveMembers: activeMembers(previous),
		},
	};
}
