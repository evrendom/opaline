import { getShellCommand } from "@/components/conversation/conversation-tools";
import { getFileOps } from "../model/session-reader-files";
import { mcpTool } from "../model/session-reader-mcp-tool";
import type { SessionReaderBody } from "../model/session-reader-model";
import {
	getToolStep,
	type SessionReaderStep,
} from "../model/session-reader-run-steps";
import { EDIT_TOOLS } from "../model/session-reader-step-lanes";

export type Failure = { count: number; label: string };

export type RunErrors = {
	hook: Failure[];
	harness: Failure[];
	declined: number;
	broken: Failure[];
	misused: Failure[];
	real: Failure[];
	exitOnly: number;
	stuck: (Failure & { streaks: number })[];
};

export const STUCK_AFTER = 3;

const HARNESS_BLOCK = /<tool_use_error>\s*Blocked:/u;
const HOOK_BLOCK = /(?:^|\]:\s*)STOP:|blocked by (?:a )?hook/imu;
const DECLINED =
	/user doesn't want to proceed|tool use was rejected|permission request failed/iu;
const HOST_FAILED =
	/automation \w+ failed|timed out|no \w+ (?:automation )?host is available|not connected|connection (?:closed|refused)|ECONNREFUSED|server (?:error|unavailable)|\b5\d\d\b.*(?:error|unavailable)/iu;
const MISUSED =
	/modified since read|has not been read yet|string to replace not found|file does not exist|no such file|found \d+ matches/iu;
const REAL_ERROR =
	/\berror TS\d+|\bTraceback \(most recent call last\)|^fatal:|^error:|\b(?:Syntax|Type|Reference|Range)Error\b|\bException\b|command not found|permission denied|npm ERR!|\bENOENT\b|Failed to connect|\(fail\)|\b[1-9]\d* fail(?:ed|ing|s)?\b|✗/imu;
const TEST_FAIL = /\bFAIL\b/u;
const FAILING_EXIT = /^Exit code (?:124|137|143)\b/mu;

function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) =>
			typeof block === "string"
				? block
				: block && typeof block === "object" && "text" in block
					? String(block.text)
					: "",
		)
		.join("\n");
}

function programOf(command: string): string {
	const steps = command
		.split(/&&|;|\|\||\n/u)
		.map((step) => step.trim())
		.filter((step) => step && !/^cd\s/u.test(step));
	for (const step of steps) {
		const word = step
			.split(/\s+/u)
			.find(
				(each) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(each) && each !== "export",
			);
		if (word) return word;
	}
	return "shell";
}

function harnessReason(text: string): string {
	return /Blocked:\s*(\S+)/u.exec(text)?.[1] ?? "a call";
}

function hookReason(text: string): string {
	const said =
		/(?:^|\]:\s*)STOP:\s*([^.\n]+)/mu.exec(text)?.[1]?.trim() ?? "a hook";
	return said.length > 48 ? `${said.slice(0, 47)}…` : said;
}

function add(list: Failure[], label: string) {
	const had = list.find((each) => each.label === label);
	if (had) had.count += 1;
	else list.push({ count: 1, label });
}

export function runErrors(body: SessionReaderBody): RunErrors {
	const out: RunErrors = {
		broken: [],
		declined: 0,
		exitOnly: 0,
		harness: [],
		hook: [],
		misused: [],
		real: [],
		stuck: [],
	};
	const streaks = new Map<string, Failure>();
	const longest = new Map<string, Failure>();
	for (const item of body.responseItems) {
		if (item.kind !== "agent") continue;
		for (const event of item.events) {
			if (event.kind !== "tool") continue;
			const command = getShellCommand(event.toolName, event.input);
			const key = command
				? command.trim()
				: `${event.toolName}:${JSON.stringify(event.input)}`;
			if (event.result?.isError !== true) {
				streaks.delete(key);
				if (EDIT_TOOLS.has(event.toolName)) streaks.clear();
				continue;
			}
			const text = resultText(event.result.content);
			const mcp = mcpTool(event.toolName);
			const what = command
				? programOf(command)
				: mcp
					? `${mcp.server} ${mcp.tool}`
					: event.toolName;
			const group = HARNESS_BLOCK.test(text)
				? "blocked by Claude Code"
				: HOOK_BLOCK.test(text)
					? "blocked by your hook"
					: DECLINED.test(text)
						? "declined by you"
						: mcp
							? HOST_FAILED.test(text)
								? "from a broken tool"
								: "misused tools"
							: !command
								? MISUSED.test(text)
									? "misused tools"
									: "real errors"
								: REAL_ERROR.test(text) ||
										TEST_FAIL.test(text) ||
										FAILING_EXIT.test(text)
									? "real errors"
									: "with only an exit code";
			if (group === "blocked by Claude Code")
				add(out.harness, harnessReason(text));
			else if (group === "blocked by your hook")
				add(out.hook, hookReason(text));
			else if (group === "declined by you") out.declined += 1;
			else if (group === "from a broken tool") add(out.broken, what);
			else if (group === "misused tools") add(out.misused, what);
			else if (group === "real errors") add(out.real, what);
			else out.exitOnly += 1;
			const streak = streaks.get(key) ?? { count: 0, label: what };
			streak.count += 1;
			streaks.set(key, streak);
			if ((longest.get(key)?.count ?? 0) < streak.count)
				longest.set(key, { ...streak });
		}
	}
	const stuck = new Map<string, Failure & { streaks: number }>();
	for (const each of longest.values()) {
		if (each.count < STUCK_AFTER) continue;
		const had = stuck.get(each.label);
		if (had) {
			had.count = Math.max(had.count, each.count);
			had.streaks += 1;
		} else stuck.set(each.label, { ...each, streaks: 1 });
	}
	out.stuck = [...stuck.values()];
	for (const list of [
		out.broken,
		out.harness,
		out.hook,
		out.misused,
		out.real,
		out.stuck,
	])
		list.sort((a, b) => b.count - a.count);
	return out;
}

export type CallRef = {
	native: string;
	step: string;
	shown: SessionReaderStep;
};

export type ErrorImpact = {
	blocked: CallRef[];
	exitOnly: CallRef[];
	quick: CallRef[];
	slow: { calls: CallRef[]; label: string; ms: number }[];
	unresolved: (Failure & { calls: CallRef[] })[];
};

function workOf(event: { input: Record<string, unknown>; toolName: string }): {
	key: string;
	label: string;
} {
	const command = getShellCommand(event.toolName, event.input);
	if (command) {
		const program = programOf(command);
		const step =
			command
				.split(/&&|;|\|\||\n/u)
				.map((each) => each.trim())
				.find((each) => each.split(/\s+/u).includes(program)) ?? "";
		const words = step.split(/\s+/u);
		const after = words.slice(words.indexOf(program) + 1);
		const what = after.some((word) => word.startsWith("<<"))
			? "inline script"
			: after.find(
					(word) => word && !word.startsWith("-") && !/^[<>|&]/u.test(word),
				);
		const label = what ? `${program} ${what}` : program;
		return { key: `shell:${label}`, label };
	}
	const mcp = mcpTool(event.toolName);
	if (mcp) return { key: event.toolName, label: `${mcp.server} ${mcp.tool}` };
	const target = ["file_path", "path", "notebook_path", "url"]
		.map((name) => event.input[name])
		.find((value) => typeof value === "string") as string | undefined;
	return {
		key: `${event.toolName}:${target ?? ""}`,
		label: target
			? `${event.toolName} ${target.split("/").pop()}`
			: event.toolName,
	};
}

const QUICK_MS = 30_000;

export function errorImpact(body: SessionReaderBody): ErrorImpact {
	const events = body.responseItems.flatMap((item) =>
		item.kind === "agent"
			? item.events.filter(
					(event): event is Extract<typeof event, { kind: "tool" }> =>
						event.kind === "tool",
				)
			: [],
	);
	const slow = new Map<string, ErrorImpact["slow"][number]>();
	const unresolved: ErrorImpact["unresolved"] = [];
	const blocked: CallRef[] = [];
	const exitOnly: CallRef[] = [];
	const quick: CallRef[] = [];
	const streaks = new Map<string, CallRef[]>();
	const refOf = (event: (typeof events)[number]): CallRef => ({
		native: event.nativeId ?? event.id,
		shown: (() => {
			const step = getToolStep(event, Date.parse(event.timestamp));
			const files = getFileOps(event);
			return files.length > 0 ? { ...step, files } : step;
		})(),
		step: event.id,
	});
	events.forEach((event, index) => {
		if (event.kind !== "tool" || event.result?.isError !== true) return;
		const text = resultText(event.result.content);
		const command = getShellCommand(event.toolName, event.input);
		if (
			HARNESS_BLOCK.test(text) ||
			HOOK_BLOCK.test(text) ||
			DECLINED.test(text)
		) {
			blocked.push(refOf(event));
			return;
		}
		if (
			command &&
			!REAL_ERROR.test(text) &&
			!TEST_FAIL.test(text) &&
			!FAILING_EXIT.test(text)
		) {
			exitOnly.push(refOf(event));
			return;
		}
		const work = workOf(event);
		const later = events.slice(index + 1);
		const tries = later.filter(
			(each) => each.kind === "tool" && workOf(each).key === work.key,
		);
		const fine = tries.find((each) => each.result?.isError !== true);
		if (!fine) {
			const had = unresolved.find((each) => each.label === work.label);
			if (had) {
				had.count += 1;
				had.calls.push(refOf(event));
			} else
				unresolved.push({ calls: [refOf(event)], count: 1, label: work.label });
			return;
		}
		const before = events
			.slice(0, index)
			.filter((each) => each.kind === "tool" && workOf(each).key === work.key)
			.at(-1);
		const streak = streaks.get(work.key);
		if (before?.result?.isError === true && streak) {
			streak.push(refOf(event));
			return;
		}
		const ms =
			Date.parse(fine.result?.timestamp ?? fine.timestamp) -
			Date.parse(event.timestamp);
		if (tries[0] === fine && ms <= QUICK_MS) {
			quick.push(refOf(event));
			streaks.set(work.key, quick);
			return;
		}
		const had = slow.get(work.label);
		if (had) {
			had.calls.push(refOf(event));
			had.ms = Math.max(had.ms, Number.isFinite(ms) ? ms : 0);
		} else
			slow.set(work.label, {
				calls: [refOf(event)],
				label: work.label,
				ms: Number.isFinite(ms) ? ms : 0,
			});
		streaks.set(work.key, slow.get(work.label)?.calls ?? quick);
	});
	return {
		blocked,
		exitOnly,
		quick,
		slow: [...slow.values()].sort((a, b) => b.ms - a.ms),
		unresolved: unresolved.sort((a, b) => b.count - a.count),
	};
}
