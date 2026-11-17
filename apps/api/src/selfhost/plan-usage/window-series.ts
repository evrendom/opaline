import type { PlanSample } from "./readings.js";

const MINUTE = 60_000;
export const COST_ROW_MS = 5 * MINUTE;
const COARSE_STEP_MS = 60 * MINUTE;
const CARRY_MS = 45 * MINUTE;
const TOP_SESSIONS = 50;
const BUCKET_SESSIONS = 4;

export interface CostRow {
	readonly sessionId: string;
	readonly agentId?: string;
	readonly at: number;
	readonly model: string;
	readonly cost: number;
}

export interface BucketSession {
	readonly sessionId: string;
	readonly points: number;
}

export type BucketKind = "reading" | "between" | "estimate";

export interface SeriesBucket {
	readonly at: string;
	readonly usedPercent: number | null;
	readonly kind: BucketKind | null;
	readonly usedRange: readonly [number, number] | null;
	readonly readAt: string | null;
	readonly plan: string | null;
	readonly usedPoints: number;
	readonly reset: boolean;
	readonly sessions: readonly BucketSession[];
}

export interface SessionShare {
	readonly sessionId: string;
	readonly points: number;
	readonly cost: number;
	readonly estimated: boolean;
}

export interface GroupShare {
	readonly id: string;
	readonly points: number;
	readonly cost: number;
	readonly estimated: boolean;
}

export interface WindowSeries {
	readonly window: string;
	readonly label: string;
	readonly windowMinutes: number | null;
	readonly usedPercent: number;
	readonly resetsAt: string | null;
	readonly checkedAt: string;
	readonly recordedFrom: string;
	readonly bucketMinutes: number;
	readonly resets: readonly string[];
	readonly buckets: readonly SeriesBucket[];
	readonly sessions: readonly SessionShare[];
	readonly sessionPoints: Readonly<Record<string, number>>;
	readonly models: readonly GroupShare[];
	readonly repositories: readonly GroupShare[];
	readonly otherPoints: number;
	readonly totalPoints: number;
}

interface Step {
	readonly t0: number;
	readonly t1: number;
	readonly base: number;
	readonly delta: number;
	readonly opens: boolean;
	readonly coarse: boolean;
	readonly synthetic?: boolean;
	readonly plan: string | null;
	readonly ends: number[];
	readonly totals: number[];
	other: number;
}

interface RowShare {
	readonly row: CostRow;
	readonly points: number;
	readonly coarse: boolean;
}

export function bucketMinutesFor(spanMs: number): number {
	const hours = spanMs / (60 * MINUTE);
	if (hours <= 25) return 15;
	if (hours <= 73) return 60;
	if (hours <= 8 * 24 + 1) return 120;
	if (hours <= 16 * 24 + 1) return 240;
	if (hours <= 32 * 24 + 1) return 480;
	return 1440;
}

function cycleStart(sample: PlanSample): number | null {
	return sample.resetsAt && sample.windowMinutes
		? Date.parse(sample.resetsAt) - sample.windowMinutes * MINUTE
		: null;
}

function stepsOf(samples: readonly PlanSample[]): Step[] {
	const steps: Step[] = [];
	let previous: PlanSample | null = null;
	let plan: string | null = null;
	const push = (
		t0: number,
		t1: number,
		base: number,
		delta: number,
		opens: boolean,
	) => {
		if (t1 <= t0) return;
		steps.push({
			t0,
			t1,
			base,
			delta,
			opens,
			plan,
			coarse: t1 - t0 > COARSE_STEP_MS,
			ends: [],
			totals: [],
			other: 0,
		});
	};
	for (const sample of samples) {
		const t1 = Date.parse(sample.at);
		const start = cycleStart(sample);
		plan = sample.plan;
		if (!previous) {
			if (start !== null) push(start, t1, 0, sample.usedPercent, true);
		} else {
			const before = Date.parse(previous.at);
			const sameCycle =
				sample.usedPercent >= previous.usedPercent &&
				(previous.resetsAt === null || t1 < Date.parse(previous.resetsAt));
			if (sameCycle)
				push(
					before,
					t1,
					previous.usedPercent,
					sample.usedPercent - previous.usedPercent,
					false,
				);
			else if (start !== null && start > before)
				push(start, t1, 0, sample.usedPercent, true);
			else push(before, t1, sample.usedPercent, 0, false);
		}
		previous = sample;
	}
	return steps;
}

const MIN_CALIBRATION_PERCENT = 3;

export function pointsPerDollar(
	samples: readonly PlanSample[],
	rows: readonly CostRow[],
): number | null {
	const latest = samples.at(-1);
	const start = latest ? cycleStart(latest) : null;
	if (!latest || start === null) return null;
	if (latest.usedPercent < MIN_CALIBRATION_PERCENT || latest.usedPercent >= 100)
		return null;
	const end = Date.parse(latest.at);
	let cost = 0;
	for (const row of rows)
		if (row.at >= start && row.at + COST_ROW_MS <= end) cost += row.cost;
	return cost > 0 ? latest.usedPercent / cost : null;
}

function earlierCycleSteps(
	samples: readonly PlanSample[],
	rows: readonly CostRow[],
	from: number,
): Step[] {
	const first = samples[0];
	const windowMs = (first?.windowMinutes ?? 0) * MINUTE;
	const firstStart = first ? cycleStart(first) : null;
	const rate = pointsPerDollar(samples, rows);
	if (!first || firstStart === null || windowMs <= 0 || rate === null)
		return [];
	const steps: Step[] = [];
	for (let end = firstStart; end > from; end -= windowMs) {
		const start = end - windowMs;
		let cost = 0;
		for (const row of rows)
			if (row.at >= start && row.at + COST_ROW_MS <= end) cost += row.cost;
		if (cost <= 0) continue;
		steps.unshift({
			t0: start,
			t1: end,
			base: 0,
			delta: Math.min(100, cost * rate),
			opens: true,
			coarse: true,
			synthetic: true,
			plan: first.plan,
			ends: [],
			totals: [],
			other: 0,
		});
	}
	return steps;
}

function share(
	steps: Step[],
	rows: readonly CostRow[],
	rate: number | null,
): RowShare[] {
	const shares: RowShare[] = [];
	let from = 0;
	let carried = false;
	for (const step of steps) {
		if (step.opens || !carried)
			while (
				from < rows.length &&
				(rows[from]?.at ?? 0) + COST_ROW_MS <= step.t0
			)
				from += 1;
		let to = from;
		let total = 0;
		while (to < rows.length && (rows[to]?.at ?? 0) + COST_ROW_MS <= step.t1) {
			total += rows[to]?.cost ?? 0;
			to += 1;
		}
		if (total <= 0) {
			step.other = step.delta;
			from = to;
			carried = false;
			continue;
		}
		if (step.delta <= 0 && !step.synthetic) {
			carried = true;
			continue;
		}
		carried = false;
		let running = 0;
		for (let index = from; index < to; index += 1) {
			const row = rows[index];
			if (!row) continue;
			const points = (step.delta * row.cost) / total;
			running += points;
			shares.push({ row, points, coarse: step.coarse });
			const end = row.at + COST_ROW_MS;
			if (step.ends.at(-1) === end)
				step.totals[step.totals.length - 1] = running;
			else {
				step.ends.push(end);
				step.totals.push(running);
			}
		}
		from = to;
	}
	let cycle = 0;
	for (const step of steps) if (step.opens) cycle = step.t0;
	let points = 0;
	let cost = 0;
	for (const entry of shares)
		if (entry.row.at >= cycle) {
			points += entry.points;
			cost += entry.row.cost;
		}
	const tailRate = cost > 0 ? points / cost : rate;
	if (tailRate !== null)
		for (let index = from; index < rows.length; index += 1) {
			const row = rows[index];
			if (row && row.at >= cycle)
				shares.push({ row, points: row.cost * tailRate, coarse: true });
		}
	return shares.sort((a, b) => a.row.at - b.row.at);
}

interface Reading {
	readonly used: number;
	readonly kind: BucketKind;
	readonly range: readonly [number, number];
	readonly readAt: string | null;
	readonly plan: string | null;
}

function latestIn(
	samples: readonly PlanSample[],
	start: number,
	end: number,
): PlanSample | null {
	let found: PlanSample | null = null;
	for (const sample of samples) {
		const at = Date.parse(sample.at);
		if (at >= end) break;
		if (at >= start) found = sample;
	}
	return found;
}

function usedAt(
	steps: readonly Step[],
	samples: readonly PlanSample[],
	time: number,
): Reading | null {
	for (const step of steps) {
		if (time <= step.t0 || time > step.t1) continue;
		const high = step.base + step.delta;
		if (time === step.t1 && !step.synthetic)
			return {
				used: high,
				kind: "between",
				range: [high, high],
				readAt: null,
				plan: step.plan,
			};
		if (step.opens && step.ends.length === 0) return null;
		let reached = 0;
		for (let index = 0; index < step.ends.length; index += 1) {
			if ((step.ends[index] ?? 0) > time) break;
			reached = step.totals[index] ?? reached;
		}
		return {
			used: step.base + reached,
			kind: step.opens ? "estimate" : "between",
			range: [step.base, high],
			readAt: null,
			plan: step.plan,
		};
	}
	let latest: PlanSample | null = null;
	for (const sample of samples) {
		if (Date.parse(sample.at) > time) break;
		latest = sample;
	}
	if (!latest || time - Date.parse(latest.at) > CARRY_MS) return null;
	if (latest.resetsAt && time >= Date.parse(latest.resetsAt)) return null;
	return {
		used: latest.usedPercent,
		kind: "between",
		range: [latest.usedPercent, latest.usedPercent],
		readAt: null,
		plan: latest.plan,
	};
}

interface Total {
	points: number;
	cost: number;
	estimated: boolean;
}

function add(totals: Map<string, Total>, key: string, entry: RowShare): void {
	const total = totals.get(key) ?? { points: 0, cost: 0, estimated: false };
	total.points += entry.points;
	total.cost += entry.row.cost;
	total.estimated ||= entry.coarse;
	totals.set(key, total);
}

function ranked(totals: ReadonlyMap<string, Total>): GroupShare[] {
	return [...totals]
		.map(([id, total]) => ({
			id,
			points: round(total.points),
			cost: round(total.cost),
			estimated: total.estimated,
		}))
		.filter((entry) => entry.points > 0)
		.sort((a, b) => b.points - a.points);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

export function buildWindowSeries(input: {
	readonly samples: readonly PlanSample[];
	readonly rows: readonly CostRow[];
	readonly from: number;
	readonly to: number;
	readonly now: number;
	readonly repositoryOf?: ReadonlyMap<string, string>;
	readonly bucketMinutes?: number;
}): WindowSeries | null {
	const samples = [...input.samples].sort((a, b) => a.at.localeCompare(b.at));
	const first = samples[0];
	const latest = samples.at(-1);
	if (!first || !latest) return null;
	const scope = latest.modelScope;
	const rows = input.rows
		.filter((row) => !scope || row.model.toLowerCase().includes(scope))
		.sort((a, b) => a.at - b.at);
	const steps = [
		...earlierCycleSteps(samples, rows, input.from),
		...stepsOf(samples),
	];
	const shares = share(steps, rows, pointsPerDollar(samples, rows));
	const bucketMinutes =
		input.bucketMinutes ?? bucketMinutesFor(input.to - input.from);
	const bucketMs = bucketMinutes * MINUTE;
	const resets = [
		...steps.filter((step) => step.opens).map((step) => step.t0),
		...samples
			.map((sample) => (sample.resetsAt ? Date.parse(sample.resetsAt) : 0))
			.filter((time) => time > 0 && time <= input.now),
	];

	const buckets: SeriesBucket[] = [];
	let shareAt = 0;
	for (let start = input.from; start < input.to; start += bucketMs) {
		const end = start + bucketMs;
		const perSession = new Map<string, number>();
		while (shareAt < shares.length && (shares[shareAt]?.row.at ?? 0) < start)
			shareAt += 1;
		let cursor = shareAt;
		while (cursor < shares.length && (shares[cursor]?.row.at ?? 0) < end) {
			const entry = shares[cursor];
			if (entry)
				perSession.set(
					entry.row.sessionId,
					(perSession.get(entry.row.sessionId) ?? 0) + entry.points,
				);
			cursor += 1;
		}
		const read = latestIn(samples, start, end);
		const reading: Reading | null = read
			? {
					used: read.usedPercent,
					kind: "reading",
					range: [read.usedPercent, read.usedPercent],
					readAt: read.at,
					plan: read.plan,
				}
			: start > input.now
				? null
				: usedAt(steps, samples, Math.min(end, input.now));
		buckets.push({
			at: new Date(start).toISOString(),
			usedPercent: reading ? round(reading.used) : null,
			kind: reading?.kind ?? null,
			usedRange: reading
				? [round(reading.range[0]), round(reading.range[1])]
				: null,
			readAt: reading?.readAt ?? null,
			plan: reading?.plan ?? null,
			usedPoints: round(
				[...perSession.values()].reduce((sum, points) => sum + points, 0) +
					steps
						.filter((step) => step.t1 >= start && step.t1 < end)
						.reduce((sum, step) => sum + step.other, 0),
			),
			reset: resets.some((time) => time >= start && time < end),
			sessions: [...perSession]
				.filter(([, points]) => points >= 0.005)
				.sort((a, b) => b[1] - a[1])
				.slice(0, BUCKET_SESSIONS)
				.map(([sessionId, points]) => ({ sessionId, points: round(points) })),
		});
	}

	const bySession = new Map<string, Total>();
	const byAgent = new Map<string, Total>();
	const byModel = new Map<string, Total>();
	const byRepository = new Map<string, Total>();
	for (const entry of shares) {
		if (entry.row.at < input.from || entry.row.at >= input.to) continue;
		add(bySession, entry.row.sessionId, entry);
		if (entry.row.agentId)
			add(byAgent, `${entry.row.sessionId}:${entry.row.agentId}`, entry);
		add(byModel, entry.row.model, entry);
		add(
			byRepository,
			input.repositoryOf?.get(entry.row.sessionId) ?? "",
			entry,
		);
	}
	const sessions = ranked(bySession).map(({ id, ...rest }) => ({
		sessionId: id,
		...rest,
	}));
	const otherPoints = steps
		.filter((step) => step.t1 >= input.from && step.t1 < input.to)
		.reduce((sum, step) => sum + step.other, 0);
	const sessionPoints = sessions.reduce((sum, entry) => sum + entry.points, 0);
	return {
		window: latest.window,
		label: latest.label,
		windowMinutes: latest.windowMinutes,
		usedPercent: latest.usedPercent,
		resetsAt: latest.resetsAt,
		checkedAt: latest.at,
		recordedFrom: first.at,
		bucketMinutes,
		resets: [
			...new Set(
				resets
					.filter((time) => time >= input.from && time < input.to)
					.map((time) => Math.round(time / MINUTE) * MINUTE),
			),
		]
			.sort((a, b) => a - b)
			.map((time) => new Date(time).toISOString()),
		buckets,
		sessions: sessions.slice(0, TOP_SESSIONS),
		sessionPoints: Object.fromEntries(
			[
				...sessions.map((entry) => [entry.sessionId, entry.points] as const),
				...ranked(byAgent).map((entry) => [entry.id, entry.points] as const),
			].filter(([, points]) => points >= 0.005),
		),
		models: ranked(byModel).slice(0, TOP_SESSIONS),
		repositories: ranked(byRepository).slice(0, TOP_SESSIONS),
		otherPoints: round(otherPoints),
		totalPoints: round(sessionPoints + otherPoints),
	};
}

export function earliestCostTime(
	samples: readonly PlanSample[],
	from: number,
): number {
	const first = samples[0];
	const windowMs = (first?.windowMinutes ?? 0) * MINUTE;
	let earliest = windowMs > 0 ? from - windowMs : from;
	for (const step of stepsOf(
		[...samples].sort((a, b) => a.at.localeCompare(b.at)),
	))
		if (step.t1 > from && step.t0 < earliest) earliest = step.t0;
	return earliest;
}
