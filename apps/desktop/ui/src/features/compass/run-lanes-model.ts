import { getRawToolInput, parseBackgroundHandOff } from "@rudel/api-routes";
import {
	formatDuration,
	stepBar,
} from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import {
	flattenSteps,
	type SessionReaderStep,
	type SessionReaderWaterfall,
} from "@/features/sessions/reader/model/session-reader-run-steps";
import {
	ACTIVITY_COLOR,
	activityOf,
	CI_WATCH,
	isSubagentMessage,
	LANES,
	type LaneKey,
	laneKeysOf,
	shellCommandOf,
} from "@/features/sessions/reader/model/session-reader-step-lanes";
import { subagentIdOf } from "@/features/sessions/reader/subagents/session-reader-agent-focus";
import { subagentTalkedTo } from "@/features/sessions/reader/subagents/session-reader-subagent-done";
import { shortSubagentId } from "@/features/sessions/run-id";
import { basename } from "@/lib/format";
import { getChainRest } from "./trace-chain";

type LaneBar = {
	stepId: string;
	from: number;
	to: number;
	className: string;
	title: string;
	open?: boolean;
	name?: string;
};

const leadOf = (step: SessionReaderStep) => step.command?.lead ?? step.name;

const commandOf = shellCommandOf;

function purposeOf(step: SessionReaderStep): string {
	const description = step.toolEvent
		? getRawToolInput(step.toolEvent.input).description
		: undefined;
	if (typeof description === "string" && description.trim())
		return description.trim();
	return commandOf(step).split("\n")[0] || leadOf(step);
}

function watchedPr(command: string): string | null {
	return /\bgh\s+pr\s+checks\s+#?(\d+)/u.exec(command)?.[1] ?? null;
}

function barColor(step: SessionReaderStep): string {
	if (step.isError) return "bg-rose-500";
	if (step.waitsOnYou || step.harness === "member") return "bg-amber-400";
	if (step.harness) return ACTIVITY_COLOR[activityOf(step)];
	if (step.kind === "message") return "bg-violet-300 dark:bg-violet-300";
	return ACTIVITY_COLOR[activityOf(step)];
}

function ownBar(step: SessionReaderStep): LaneBar {
	const from = step.queuedUntilMs ?? step.startMs;
	return {
		className: barColor(step),
		from,
		stepId: step.id,
		title: `${leadOf(step)} · ${formatDuration(step.endMs - from)}`,
		to: step.backgroundFromMs ?? step.endMs,
	};
}

function backgroundSpan(
	step: SessionReaderStep,
): { from: number; to: number | null } | null {
	if (step.kind !== "tool") return null;
	if (step.backgroundFromMs !== undefined)
		return { from: step.backgroundFromMs, to: step.endMs };
	const handedOff =
		step.toolEvent?.background ??
		(step.result
			? parseBackgroundHandOff(step.toolEvent?.toolName, step.result)
			: null);
	return handedOff ? { from: step.endMs, to: null } : null;
}

export type Lane = {
	bars: LaneBar[];
	counts: "bars" | "none" | number;
	failed?: number;
	id: string;
	key: LaneKey;
	label: string;
};

function agentRows(bars: readonly LaneBar[], label: string): Lane[] {
	const rows: { bars: LaneBar[]; until: number }[] = [];
	for (const bar of [...bars].sort((a, b) => a.from - b.from)) {
		const row = rows.find((each) => each.until <= bar.from);
		if (row) {
			row.bars.push(bar);
			row.until = bar.to;
		} else rows.push({ bars: [bar], until: bar.to });
	}
	return rows.map((row, index) => ({
		bars: row.bars,
		counts: index === 0 ? bars.length : "none",
		id: `agent:${index}`,
		key: "agent",
		label: rows.length > 1 ? `${label} ${index + 1}` : label,
	}));
}

export function ranOnPast(bars: readonly LaneBar[], endMs: number): number {
	return Math.max(
		0,
		...bars.filter((bar) => !bar.open).map((bar) => bar.to - endMs),
	);
}

const UNKNOWN_END =
	"kept running in the background; when it ended isn't recorded";

function backgroundBars(steps: readonly SessionReaderStep[]): LaneBar[] {
	return steps.flatMap((step) => {
		if (CI_WATCH.test(commandOf(step)) || isSubagentMessage(step)) return [];
		const span = backgroundSpan(step);
		if (!span) return [];
		const status = step.toolEvent?.background?.status;
		return [
			{
				className: step.isError ? "bg-rose-500/80" : "bg-blue-500/70",
				from: span.from,
				name: purposeOf(step),
				open: span.to === null,
				stepId: step.id,
				title:
					span.to === null
						? `${purposeOf(step)} · ${UNKNOWN_END}`
						: `${purposeOf(step)} · ran ${formatDuration(span.to - span.from)} in the background${status ? `, ${status}` : ""}`,
				to: span.to ?? span.from,
			},
		];
	});
}

function ciBars(
	steps: readonly SessionReaderStep[],
	model: string | null,
): LaneBar[] {
	const leaves = (step: SessionReaderStep): SessionReaderStep[] =>
		step.children.length > 0 ? step.children.flatMap(leaves) : [step];
	const jobs = steps
		.filter((step) => step.kind === "ci")
		.flatMap(leaves)
		.map((job) => ({
			className: stepBar(job, model).className ?? "bg-zinc-400",
			from: job.startMs,
			stepId: job.id,
			title: `${job.name} · ${formatDuration(job.endMs - job.startMs)}`,
			to: job.endMs,
		}));
	const watched = steps.flatMap((step) => {
		const command = commandOf(step);
		if (step.kind !== "tool" || !CI_WATCH.test(command)) return [];
		const span = backgroundSpan(step) ?? { from: step.startMs, to: step.endMs };
		const pr = watchedPr(command);
		const label = pr ? `PR #${pr} checks` : "PR checks";
		return [
			{
				className:
					span.to === null
						? "bg-zinc-400"
						: step.isError
							? "bg-rose-500"
							: "bg-zinc-400",
				from: span.from,
				name: label,
				open: span.to === null,
				stepId: step.id,
				title:
					span.to === null
						? `${label}: watched, then ${UNKNOWN_END}`
						: `${label}: watched for ${formatDuration(span.to - span.from)}, ${step.isError ? "failed" : "passed"}`,
				to: span.to ?? span.from,
			},
		];
	});
	return [...jobs, ...watched];
}

export function ciOutcomeTint(bars: readonly LaneBar[]): string | null {
	return bars.some((bar) => bar.className.includes("bg-rose-"))
		? "var(--color-rose-500)"
		: null;
}

const FILE_WORK = new Set<LaneKey>(["edit", "read", "search", "write"]);

const FILE_LANES = {
	edit: { color: "bg-yellow-500", verb: "Edited" },
	read: { color: "bg-cyan-500", verb: "Read" },
	write: { color: "bg-lime-500", verb: "Wrote" },
} as const;

function answeredAfter(step: SessionReaderStep): string {
	const at = step.toolEvent?.background?.finishedAt;
	return at
		? ` · answered ${formatDuration(Date.parse(at) - step.endMs)} later`
		: "";
}

function reportingSubagent(step: SessionReaderStep): string {
	const id = step.notification?.taskId;
	return id ? shortSubagentId(id) : "A subagent";
}

function messagedSubagent(step: SessionReaderStep): string {
	const to = step.toolEvent
		? getRawToolInput(step.toolEvent.input).to
		: undefined;
	return typeof to === "string" && to ? shortSubagentId(to) : "a subagent";
}

function laneBar(step: SessionReaderStep, key: LaneKey): LaneBar {
	const bar =
		step.kind === "agent"
			? {
					...ownBar(step),
					title: `Launched ${leadOf(step)}`,
					to: step.backgroundFromMs ?? step.queuedUntilMs ?? step.startMs,
				}
			: key === "message"
				? step.harness === "notification"
					? {
							...ownBar(step),
							title: `${reportingSubagent(step)} reported · ${step.name}`,
						}
					: {
							...ownBar(step),
							title: `Message to ${messagedSubagent(step)}${answeredAfter(step)}`,
						}
				: ownBar(step);
	if (key !== "read" && key !== "edit" && key !== "write") return bar;
	const look = FILE_LANES[key];
	const names = (step.files ?? [])
		.filter((op) => op.operation === key)
		.map((op) => basename(op.path));
	return {
		...bar,
		className: step.isError ? "bg-rose-500" : look.color,
		name: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0],
		title: names.length
			? `${look.verb} ${names.join(", ")} · ${leadOf(step)} · ${formatDuration(bar.to - bar.from)}`
			: bar.title,
	};
}

export function getLanes(waterfall: SessionReaderWaterfall): Lane[] {
	const { steps } = waterfall;
	const bars = new Map<LaneKey, LaneBar[]>();
	const put = (key: LaneKey, bar: LaneBar) => {
		const lane = bars.get(key) ?? [];
		lane.push(bar);
		bars.set(key, lane);
	};
	for (const step of steps) {
		const keys = laneKeysOf(step);
		const touched = keys.filter((key) => FILE_WORK.has(key));
		const chain =
			step.command && touched.length > 0 ? getChainRest(commandOf(step)) : null;
		if (!chain) {
			for (const key of keys) put(key, laneBar(step, key));
			continue;
		}
		const at = chain.filesFirst
			? (step.queuedUntilMs ?? step.startMs)
			: step.endMs;
		for (const key of touched)
			put(key, { ...laneBar(step, key), from: at, to: at });
		put(chain.lane, {
			...ownBar(step),
			className: step.isError
				? "bg-rose-500"
				: ACTIVITY_COLOR[chain.lane === "shell" ? "run" : chain.lane],
			title: `${chain.parts.join(" → ")} · ${formatDuration(step.endMs - (step.queuedUntilMs ?? step.startMs))}`,
		});
	}
	bars.set("background", backgroundBars(steps));
	bars.set("ci", ciBars(steps, waterfall.model));
	return LANES.flatMap((lane) => {
		const own = bars.get(lane.key) ?? [];
		return lane.key === "agent" && own.length > 0
			? agentRows(own, lane.label)
			: [{ ...lane, bars: own, counts: "bars" as const, id: lane.key }];
	});
}

export function classTint(className: string): string {
	const match = /\bbg-([a-z]+)-(\d{2,3})\b/u.exec(className);
	return match
		? `var(--color-${match[1]}-${match[2]})`
		: "var(--color-slate-500)";
}

export function formatPreciseOffset(ms: number): string {
	const total = Math.max(Math.round(ms), 0);
	const seconds = `${((total % 60_000) / 1000).toFixed(3)}s`;
	const minutes = Math.floor(total / 60_000) % 60;
	const hours = Math.floor(total / 3_600_000);
	if (hours > 0) return `+${hours}h ${minutes}m ${seconds}`;
	if (minutes > 0) return `+${minutes}m ${seconds}`;
	return `+${seconds}`;
}

export type Span = { from: number; to: number };

export const SUBAGENT_LANE = "subagent:";

export type SubagentGroup = { head: Lane; id: string };

export function getSubagentGroups(
	waterfall: SessionReaderWaterfall,
): SubagentGroup[] {
	return waterfall.steps
		.filter((step) => step.kind === "agent")
		.map((step) => {
			const id = subagentIdOf(step);
			const talks = id
				? waterfall.steps.filter((each) => subagentTalkedTo(each) === id)
				: [];
			const told = [step, ...talks.filter((each) => !each.harness)];
			return {
				head: {
					bars: [laneBar(step, "agent"), ...talks.map(ownBar)],
					counts: told.length,
					failed: flattenSteps(step.children).filter(
						(each) => each.isError && each.harness !== "notification",
					).length,
					id: `${SUBAGENT_LANE}${step.id}`,
					key: "agent" as const,
					label: purposeOf(step),
				},
				id: step.id,
			};
		});
}
