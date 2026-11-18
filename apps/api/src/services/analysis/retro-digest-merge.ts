import {
	CALL_METRICS,
	type CallMetric,
	DIGEST_IDS,
	DIGEST_LIMITS,
} from "./retro-digest-sql.js";

type Row = Record<string, unknown>;
type Tuple = unknown[];
type Merge = (values: readonly unknown[]) => unknown;

const num = (value: unknown) => Number(value ?? 0) || 0;
const str = (value: unknown) =>
	value === null || value === undefined ? "" : String(value);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const tuples = (value: unknown): Tuple[] =>
	arr(value).map((item) => (Array.isArray(item) ? item : []));
const order = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;
const round1 = (value: number) => Math.round(value * 10) / 10;

type Compare = (left: Tuple, right: Tuple) => number;

const byText =
	(index: number): Compare =>
	(left, right) =>
		order(str(left[index]), str(right[index]));
const byNumberDesc =
	(index: number): Compare =>
	(left, right) =>
		num(right[index]) - num(left[index]);
const by =
	(...compares: Compare[]): Compare =>
	(left, right) => {
		for (const compare of compares) {
			const result = compare(left, right);
			if (result !== 0) return result;
		}
		return 0;
	};

const concat: Merge = (values) => values.flatMap(tuples);

const sorted =
	(compare: Compare, limit?: number): Merge =>
	(values) =>
		values
			.flatMap(tuples)
			.sort(compare)
			.slice(0, limit ?? Number.POSITIVE_INFINITY);

const distinctSorted =
	(compare: Compare, limit: number): Merge =>
	(values) => {
		const seen = new Map<string, Tuple>();
		for (const tuple of values.flatMap(tuples))
			seen.set(JSON.stringify(tuple), tuple);
		return [...seen.values()].sort(compare).slice(0, limit);
	};

const total: Merge = (values) =>
	values.reduce<number>((sum, value) => sum + num(value), 0);

const summed: Merge = (values) => {
	const rows = values.map((value) => arr(value).map(num));
	return Array.from(
		{ length: Math.max(0, ...rows.map((row) => row.length)) },
		(_, index) => rows.reduce((sum, row) => sum + (row[index] ?? 0), 0),
	);
};

const grouped =
	(
		keys: number,
		sums: readonly number[],
		compare: Compare,
		limit?: number,
		pick: Readonly<
			Record<number, (left: unknown, right: unknown) => unknown>
		> = {},
	): Merge =>
	(values) => {
		const groups = new Map<string, Tuple>();
		for (const tuple of values.flatMap(tuples)) {
			const key = JSON.stringify(tuple.slice(0, keys));
			const seen = groups.get(key);
			if (!seen) {
				groups.set(key, [...tuple]);
				continue;
			}
			for (const index of sums)
				seen[index] = num(seen[index]) + num(tuple[index]);
			for (const [index, choose] of Object.entries(pick))
				seen[Number(index)] = choose(seen[Number(index)], tuple[Number(index)]);
		}
		return [...groups.values()]
			.sort(compare)
			.slice(0, limit ?? Number.POSITIVE_INFINITY);
	};

const unrecorded: Merge = (values) => {
	const runs = new Map<string, number>();
	for (const value of values) {
		const pieceRuns = new Map<string, number>();
		for (const t of tuples(value)) pieceRuns.set(str(t[0]), num(t[3]));
		for (const [source, n] of pieceRuns)
			runs.set(source, (runs.get(source) ?? 0) + n);
	}
	return (grouped(2, [2], by(byText(0), byText(1)))(values) as Tuple[]).map(
		(t) => [t[0], t[1], t[2], runs.get(str(t[0])) ?? 0],
	);
};

const lower = (left: unknown, right: unknown) =>
	order(str(right), str(left)) < 0 ? right : left;

const CALL_LIMIT = Math.max(
	...Object.values(CALL_METRICS).map((metric) => metric.limit),
);

const descending = (left: Tuple, right: Tuple): number => {
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const a = left[index];
		const b = right[index];
		const result =
			typeof a === "string" || typeof b === "string"
				? order(str(b), str(a))
				: num(b) - num(a);
		if (result !== 0) return result;
	}
	return 0;
};

interface RankedKey {
	key: string;
	n: number;
	f: number;
	w: number;
	sessions: number;
	timed: number;
	ids: Tuple[];
	lead: Tuple;
	leadKey: Tuple;
}

const rankedPieces: Merge = (values) => {
	const metrics = new Map<string, Map<string, RankedKey>>();
	for (const value of values)
		for (const [metric, rows] of tuples(value)) {
			const keys = metrics.get(str(metric)) ?? new Map<string, RankedKey>();
			for (const t of tuples(rows)) {
				const key = str(t[0]);
				const seen = keys.get(key);
				const lead = arr(t[6]);
				const leadKey = arr(t[7]);
				if (!seen) {
					keys.set(key, {
						key,
						n: num(t[1]),
						f: num(t[2]),
						w: num(t[3]),
						sessions: num(t[4]),
						timed: num(t[8]),
						ids: tuples(t[5]),
						lead,
						leadKey,
					});
					continue;
				}
				seen.n += num(t[1]);
				seen.f += num(t[2]);
				seen.w += num(t[3]);
				seen.sessions += num(t[4]);
				seen.timed += num(t[8]);
				seen.ids.push(...tuples(t[5]));
				if (descending(seen.leadKey, leadKey) > 0) {
					seen.lead = lead;
					seen.leadKey = leadKey;
				}
			}
			metrics.set(str(metric), keys);
		}
	return [...metrics].map(([metric, keys]) => {
		const rule = CALL_METRICS[metric as CallMetric];
		const weight = (row: RankedKey) =>
			rule?.order === "w"
				? round1(row.w)
				: rule?.order === "sessions"
					? row.sessions
					: row.n;
		const kept = [...keys.values()].filter(
			(row) => metric !== "inline_scripts" || row.sessions >= 3,
		);
		const rows = kept
			.sort(
				(left, right) =>
					weight(right) - weight(left) ||
					right.n - left.n ||
					order(left.key, right.key),
			)
			.slice(0, CALL_LIMIT)
			.map((row) => [
				row.key,
				row.n,
				row.f,
				round1(row.w),
				row.sessions,
				row.ids
					.sort(descending)
					.slice(0, DIGEST_IDS)
					.map((id) => id[3]),
				row.lead[0] ?? "",
				row.lead[1] ?? "",
				row.timed,
			]);
		return [metric, rows, kept.length];
	});
};

export const DIGEST_MERGES: Readonly<Record<string, Merge>> = {
	sessions: concat,
	repeats: sorted(
		by(byNumberDesc(1), byText(2), byText(0)),
		DIGEST_LIMITS.repeats,
	),
	repeat_totals: summed,
	rule_totals: summed,
	rules: grouped(
		1,
		[1, 2],
		(left, right) =>
			Math.min(num(right[1]), num(right[2])) -
				Math.min(num(left[1]), num(left[2])) ||
			num(right[2]) - num(left[2]) ||
			order(str(right[6]), str(left[6])) ||
			order(str(left[0]), str(right[0])),
		DIGEST_LIMITS.rules,
		{
			3: (left) => left,
			4: (left) => left,
			5: (left) => left,
			6: (left, right) => (order(str(left), str(right)) < 0 ? right : left),
		},
	),
	streams: sorted(by(byText(0), byText(1)), DIGEST_LIMITS.streams),
	streams_total: total,
	models: grouped(
		1,
		[1, 2, 3],
		by(byNumberDesc(1), byText(0)),
		DIGEST_LIMITS.models,
	),
	models_total: total,
	unrecorded,
	runs_by_source: grouped(1, [1], byText(0)),
	links: distinctSorted(
		by(byText(0), byText(1), byText(2)),
		DIGEST_LIMITS.links,
	),
	links_total: total,
	ranked: rankedPieces,
	share: summed,
	push_stats: summed,
	edits: sorted(
		by(byText(0), (l, r) => num(l[3]) - num(r[3]), byText(1)),
		DIGEST_LIMITS.edits,
	),
	edits_total: total,
	per_session: concat,
	sub_spans: sorted(by(byText(0), byText(1)), DIGEST_LIMITS.sub_spans),
	sub_spans_total: total,
	compactions: grouped(
		3,
		[3, 4],
		by(byNumberDesc(3), byText(0)),
		DIGEST_LIMITS.compactions,
		{ 5: lower },
	),
	compactions_total: total,
	runs: sorted(by(byText(1), byText(2), (l, r) => num(l[3]) - num(r[3]))),
	failures: concat,
	asked: concat,
};

export function mergeDigestRows(pieces: readonly Row[]): Row {
	const columns = [...new Set(pieces.flatMap((row) => Object.keys(row)))];
	return Object.fromEntries(
		columns.map((column) => {
			const merge = DIGEST_MERGES[column];
			if (!merge)
				throw new Error(`digest column ${column} has no merge across windows`);
			return [column, merge(pieces.map((row) => row[column]))];
		}),
	);
}
