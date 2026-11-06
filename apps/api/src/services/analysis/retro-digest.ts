import { maskCredentialText, redactReturnedText } from "@rudel/secret-filter";
import {
	CALL_METRICS,
	type CallMetric,
	DIGEST_IDS,
} from "./retro-digest-sql.js";

export type Row = Record<string, unknown>;

export interface DigestRow {
	readonly metric: string;
	readonly value: string;
	readonly definition: string;
	readonly sessions: string[];
	readonly example?: string;
}

export interface DigestSection {
	readonly id: string;
	readonly title: string;
	readonly rows: DigestRow[];
	readonly missing: string[];
}

export interface Digest {
	readonly scope: {
		readonly repository: string | null;
		readonly from: string;
		readonly to: string;
		readonly latest: number | null;
		readonly listed: number | null;
	};
	readonly sessions: number;
	readonly bySource: Record<string, number>;
	readonly notRecorded: Record<string, string[]>;
	readonly coverage: Coverage;
	readonly sections: DigestSection[];
}

export interface DigestInputs {
	readonly sessions: Row;
	readonly calls: Row;
	readonly edits: Row;
	readonly usage: Row;
	readonly runs: Row;
	readonly severity: readonly Row[];
	readonly startDirs: readonly Row[];
	readonly contextSizes: readonly Row[];
	readonly patterns: readonly Row[];
}

const num = (value: unknown) => Number(value ?? 0) || 0;
const str = (value: unknown) =>
	value === null || value === undefined ? "" : String(value);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const tuples = (value: unknown): unknown[][] =>
	arr(value).map((item) => (Array.isArray(item) ? item : []));

export const fmt = (value: number, digits = 0) =>
	value.toLocaleString("en-US", {
		maximumFractionDigits: digits,
		minimumFractionDigits: 0,
	});

export const kilo = (tokens: number) =>
	tokens >= 1_000_000
		? `${fmt(tokens / 1_000_000, 1)}M`
		: tokens >= 1_000
			? `${fmt(tokens / 1_000)}k`
			: fmt(tokens);

const mins = (value: number) => fmt(value, value >= 100 ? 0 : 1);

const minutes = (row: Ranked) =>
	`${mins(row.w)} min${row.timed < row.n * 0.9 ? ` (${fmt(row.timed)} timed)` : ""}`;

const pct = (part: number, whole: number) =>
	whole > 0 ? `${fmt((100 * part) / whole, 1)}%` : "n/a";

const ex = (sid: string, turn: unknown, aid = "") =>
	sid ? `${sid}${aid ? `:${aid}` : ""}#${num(turn)}` : "";

export function homePath(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/u, "~");
}

export function resolvePath(file: string, base: string): string {
	const raw = homePath(file.trim());
	const joined =
		raw.startsWith("/") || raw.startsWith("~")
			? raw
			: `${homePath(base).replace(/\/+$/u, "")}/${raw}`;
	const parts: string[] = [];
	for (const part of joined.split("/")) {
		if (part === "." || (part === "" && parts.length > 0)) continue;
		if (part === ".." && parts.length > 1) parts.pop();
		else parts.push(part);
	}
	return parts.join("/");
}

export function isScratch(path: string): boolean {
	return /^(~\/\.|\/tmp\/|\/private\/|\/var\/)/u.test(path);
}

export const SOURCE_DIRS = new Set([
	"apps",
	"packages",
	"src",
	"lib",
	"libs",
	"test",
	"tests",
	"docs",
	"scripts",
	"crates",
	"cmd",
	"internal",
	"pkg",
	"services",
	".github",
	".context",
]);

export function markerRoot(path: string): string | null {
	const parts = path.split("/");
	const marker = parts.findIndex(
		(part, index) => index >= 2 && SOURCE_DIRS.has(part),
	);
	return marker > 0 ? parts.slice(0, marker).join("/") : null;
}

export function worktreeOf(path: string, starts: readonly string[]): string {
	const start = starts.find(
		(dir) => dir !== "" && (path === dir || path.startsWith(`${dir}/`)),
	);
	if (start) return start;
	const root = markerRoot(path);
	if (root) return root;
	const parts = path.split("/");
	if (parts[0] === "~")
		return parts.slice(0, Math.min(3, parts.length - 1)).join("/");
	return parts.slice(0, Math.min(4, parts.length - 1)).join("/");
}

interface Interval {
	readonly t0: number;
	readonly t1: number;
}

export function peakConcurrency(spans: readonly Interval[]): number {
	const points = spans.flatMap((span) => [
		[span.t0, 1],
		[span.t1, -1],
	]);
	points.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0));
	let open = 0;
	let peak = 0;
	for (const [, step] of points) {
		open += step ?? 0;
		peak = Math.max(peak, open);
	}
	return peak;
}

export const FACT_NAMES: Readonly<Record<string, string>> = {
	timed_out_calls: "call timeouts",
	denied_calls: "refusals",
	compact_trigger: "compaction trigger",
	interrupt_markers: "interrupts",
	model: "model",
	hook_runs: "stop hooks",
	permission_prompts: "permission prompts",
	subagent_types: "subagent types",
	git_operations: "git operations",
};

export const NO_QUEUED_PROMPTS = new Set(["codex"]);

export interface NotRecorded {
	readonly sources: readonly string[];
	readonly bySource: Record<string, string[]>;
	has(source: string, fact: string): boolean;
}

export function notRecordedOf(row: Row, calls: Row): NotRecorded {
	const runs = new Map(
		tuples(row.runs_by_source).map((t) => [str(t[0]), num(t[1])]),
	);
	const missing = new Map<string, Set<string>>();
	for (const t of tuples(row.unrecorded)) {
		const source = str(t[0]);
		if (num(t[2]) * 2 <= (runs.get(source) ?? 0)) continue;
		missing.set(source, (missing.get(source) ?? new Set()).add(str(t[1])));
	}
	const share = arr(calls.share).map(num);
	const bySource: Record<string, string[]> = {};
	for (const source of [...runs.keys()].sort()) {
		const facts = [...(missing.get(source) ?? [])]
			.filter((fact) => fact in FACT_NAMES)
			.map((fact) => FACT_NAMES[fact] as string);
		if (NO_QUEUED_PROMPTS.has(source)) facts.push("queued prompts");
		if (
			source === "codex" &&
			(share[4] ?? 0) > 0 &&
			(share[7] ?? 0) < (share[4] ?? 0) * 0.1
		)
			facts.push("minutes of commands a script ran");
		bySource[source] = facts.sort();
	}
	return {
		sources: [...runs.keys()].sort(),
		bySource,
		has: (source, fact) => missing.get(source)?.has(fact) ?? false,
	};
}

interface Session {
	readonly sid: string;
	readonly source: string;
	readonly launcher: string;
	readonly firstTurn: number;
	readonly prompts: number;
	readonly interrupts: number;
	readonly reasks: number;
	readonly wall: number;
	readonly active: number;
	readonly mainRuns: number;
	readonly genuine: number;
	readonly queued: number;
	readonly files: readonly string[];
	readonly longestTurn: number;
	readonly start: string;
}

function sessionsOf(row: Row, startDirs: readonly Row[]): Session[] {
	const dirs = new Map(
		startDirs.map((dir) => [str(dir.session_id), homePath(str(dir.start_dir))]),
	);
	return tuples(row.sessions).map((t) => ({
		sid: str(t[0]),
		source: str(t[1]),
		launcher: str(t[2]),
		firstTurn: num(t[3]),
		prompts: num(t[4]),
		interrupts: num(t[5]),
		reasks: num(t[6]),
		wall: num(t[7]),
		active: num(t[8]),
		mainRuns: num(t[9]),
		genuine: num(t[10]),
		queued: num(t[11]),
		files: arr(t[12]).map(str),
		longestTurn: num(t[13]),
		start: dirs.get(str(t[0])) ?? "",
	}));
}

export function setupName(file: string): string {
	const [kind = "", scope = "", ...rest] = file.split(" ");
	const name = rest.join(" ").replace(/^repository:[^:]+:/u, "repo:");
	const parts = name.split("/");
	const path =
		parts.length > 5
			? [...parts.slice(0, 2), "…", ...parts.slice(-2)].join("/")
			: name;
	return `${kind === "skill_body" ? "skill " : scope === "member" ? "" : ""}${path}`;
}

interface Ranked {
	readonly key: string;
	readonly n: number;
	readonly f: number;
	readonly w: number;
	readonly sessions: number;
	readonly ids: string[];
	readonly ex: string;
	readonly label: string;
	readonly timed: number;
}

function ranked(calls: Row, metric: CallMetric): Ranked[] {
	const found = tuples(calls.ranked).find((t) => str(t[0]) === metric);
	return tuples(found?.[1])
		.slice(0, CALL_METRICS[metric].limit)
		.map((t) => ({
			key: str(t[0]),
			n: num(t[1]),
			f: num(t[2]),
			w: num(t[3]),
			sessions: num(t[4]),
			ids: arr(t[5]).map(str),
			ex: str(t[6]),
			label: str(t[7]),
			timed: num(t[8]),
		}));
}

function count<T>(
	items: readonly T[],
	keyOf: (item: T) => string,
): [string, number][] {
	const counts = new Map<string, number>();
	for (const item of items)
		counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function topSessions<T extends { sid: string }>(
	items: readonly T[],
	weight: (item: T) => number,
	n = DIGEST_IDS,
): T[] {
	return [...items]
		.sort((a, b) => weight(b) - weight(a) || a.sid.localeCompare(b.sid))
		.slice(0, n);
}

function quantile(sorted: readonly number[], q: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(q * sorted.length) - 1),
	);
	return sorted[index] ?? 0;
}

const SECRET_TOKEN =
	/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[A-Za-z0-9+/=\\\s]*)|\b(?:sk-[A-Za-z0-9_-]{8,}|gh[opsur]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{8,}|AIza[0-9A-Za-z_-]{8,}|eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2})/gu;

const TOKEN_PREFIX =
	/^(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-|gh[opsur]_|github_pat_|xox[baprs]-|AKIA|AIza|eyJ)/u;

const lengthMask = (prefix: string, secret: string) =>
	`${prefix}…[${[...secret].length} chars]`;

export function maskSecrets(text: string): string {
	if (!text) return text;
	const tokens = text.replace(SECRET_TOKEN, (token) =>
		lengthMask(TOKEN_PREFIX.exec(token)?.[0] ?? "", token),
	);
	return redactReturnedText(
		maskCredentialText(tokens, (value) => lengthMask("", value)),
	);
}

const LENGTH_MASK = /…\[\d+ chars\]/gu;

const short = (text: string, max = 70) => {
	const masked = maskSecrets(text);
	if (masked.length <= max) return masked;
	let cut = max - 1;
	for (const mask of masked.matchAll(LENGTH_MASK)) {
		const end = mask.index + mask[0].length;
		if (mask.index < cut && end > cut) cut = end;
	}
	return cut >= masked.length ? masked : `${masked.slice(0, cut)}…`;
};

function patternRows(
	patterns: readonly Row[],
	kind: string,
	limit: number,
	definition: string,
): DigestRow[] {
	return patterns
		.filter((row) => str(row.kind) === kind)
		.filter(
			(row, index, rows) =>
				index === 0 ||
				["count", "runs", "sessions"].some(
					(key) => num(row[key]) !== num(rows[index - 1]?.[key]),
				),
		)
		.slice(0, limit)
		.map((row) => {
			const examples = arr(row.examples).map(str);
			const sessions = [
				...new Set(examples.map((e) => e.split(/[:#]/u)[0] ?? "")),
			].filter(Boolean);
			return {
				metric: `${str(row.id)} ${short(str(row.signature), 48)}`,
				value: `${fmt(num(row.count))} in ${fmt(num(row.runs))} runs, ${fmt(num(row.sessions))} sessions, ${fmt(num(row.minutes), 1)} min`,
				definition: row.merged
					? `${definition}; ${str(row.merged)}`
					: definition,
				sessions: sessions.slice(0, DIGEST_IDS),
				example: examples[0] ?? "",
			};
		});
}

function setupSection(
	sessions: readonly Session[],
	calls: Row,
	edits: EditFacts,
): DigestSection {
	const rows: DigestRow[] = [];
	const missing: string[] = [];
	const byStart = new Map<string, Session[]>();
	for (const session of sessions)
		byStart.set(session.start || "(not recorded)", [
			...(byStart.get(session.start || "(not recorded)") ?? []),
			session,
		]);
	const starts = [...byStart].sort(
		(a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
	);
	const lead = starts[0]?.[1] ?? [];
	const topStart = topSessions(lead, (s) => s.wall);
	if (starts.length)
		rows.push({
			metric: "start dirs",
			value: `${starts
				.slice(0, 2)
				.map(
					([dir, group]) =>
						`${dir} ${group.length} (${count(group, (s) => s.source)
							.map(([source, n]) => `${source} ${n}`)
							.join(", ")})`,
				)
				.join(
					"; ",
				)}${starts.length > 2 ? `; ${starts.length - 2} more dirs, ${starts.slice(2).reduce((sum, [, g]) => sum + g.length, 0)} sessions` : ""}`,
			definition:
				"sessions by session_analytics.project_path, the dir the agent started in (not runs.cwd, which follows cd)",
			sessions: topStart.map((s) => s.sid),
			example: ex(topStart[0]?.sid ?? "", topStart[0]?.firstTurn),
		});
	const profiled = starts.filter(([, g]) => g.length >= 2).slice(0, 2);
	const rest = starts
		.filter(([dir]) => !profiled.some(([shown]) => shown === dir))
		.flatMap(([, g]) => g);
	const groups: [string, Session[]][] = [
		...profiled,
		...(rest.length ? [["other dirs", rest] as [string, Session[]]] : []),
	];
	if (groups.length) {
		const bare = sessions.filter((s) =>
			s.files.every((f) => f.startsWith("skill_body")),
		);
		const top = topSessions(bare.length ? bare : sessions, (s) => s.wall);
		rows.push({
			metric: "loaded at start",
			value: groups
				.map(([dir, group]) => {
					const files = count(
						group.flatMap((s) => s.files),
						(file) => file,
					);
					const none = group.filter((s) =>
						s.files.every((f) => f.startsWith("skill_body")),
					).length;
					return `${dir} (${group.length}): ${
						files
							.slice(0, 2)
							.map(([file, n]) => `${setupName(file)} ${n}`)
							.join(", ") || "none"
					}${none ? `, no instruction file ${none}` : ""}`;
				})
				.join("; "),
			definition:
				"instruction and skill files (setup_files) of each session's first main-stream run, sessions per start dir",
			sessions: top.map((s) => s.sid),
			example: ex(top[0]?.sid ?? "", top[0]?.firstTurn),
		});
	}
	if (edits.outside.length)
		rows.push({
			metric: "edits outside the start dir",
			value: `${edits.outside.length} of ${edits.editing} sessions that edited non-scratch files; top: ${edits.outsideRoots
				.slice(0, 2)
				.map(([root, n]) => `${root} ${n}`)
				.join(", ")}`,
			definition:
				"sessions with a successful edit (changed_files, joined to the run's cwd) outside their start dir, ~/.* and /tmp left out",
			sessions: edits.outside.slice(0, DIGEST_IDS).map((o) => o.sid),
			example: edits.outside[0]?.ex ?? "",
		});
	const refusals = ranked(calls, "refusals");
	if (refusals.length)
		rows.push({
			metric: "refused before running",
			value: refusals
				.slice(0, 4)
				.map(
					(refusal) =>
						`${short(refusal.key, 60)} ${fmt(refusal.n)} calls ${refusal.sessions} sess`,
				)
				.join("; "),
			definition:
				"calls with a denial_kind (hook, guard, permission rule, person), by kind and reason; all levels",
			sessions: refusals[0]?.ids ?? [],
			example: refusals[0]?.ex ?? "",
		});
	else missing.push("refusals: none");
	return { id: "a", title: "Start and setup", rows, missing };
}

function failuresSection(calls: Row, patterns: readonly Row[]): DigestSection {
	const share = arr(calls.share).map(num);
	const [
		agent = 0,
		failed = 0,
		main = 0,
		mainFailed = 0,
		inner = 0,
		innerFailed = 0,
		sessions = 0,
	] = share;
	const rows: DigestRow[] = [
		{
			metric: "failed agent calls",
			value: `${fmt(failed)} of ${fmt(agent)} (${pct(failed, agent)}) in ${sessions} sessions; main stream ${fmt(mainFailed)}/${fmt(main)} (${pct(mainFailed, main)})${inner ? `; inner ${fmt(innerFailed)}/${fmt(inner)}` : ""}`,
			definition:
				"calls with failed = 1; agent calls = call_level top or script; inner = calls a Codex script ran",
			sessions: [],
		},
		...patternRows(
			patterns,
			"failing_call",
			3,
			"patterns failing_call: failed or refused calls with this error; drill by id",
		),
		...patternRows(
			patterns,
			"retry_loop",
			2,
			"patterns retry_loop: same failing command 3+ times in a run, or edit-check-fail 3+ times",
		),
	];
	return { id: "b", title: "Failures", rows, missing: [] };
}

interface EditFacts {
	readonly editing: number;
	readonly outside: { sid: string; n: number; ex: string }[];
	readonly outsideRoots: [string, number][];
	readonly scripts: {
		dir: string;
		sessions: string[];
		files: number;
		ex: string;
	}[];
	readonly recreated: { file: string; sid: string; ex: string }[];
}

const SCRIPT_FILE = /\.(py|sh|bash|zsh|mjs|cjs|js|ts|rb|pl|sql)$/u;

export function editFacts(row: Row, sessions: readonly Session[]): EditFacts {
	const startOf = new Map(sessions.map((s) => [s.sid, s.start]));
	const starts = [...new Set(sessions.map((s) => s.start).filter(Boolean))];
	interface Edit {
		sid: string;
		at: number;
		path: string;
		op: string;
		ex: string;
	}
	const edits: Edit[] = [];
	for (const t of tuples(row.edits)) {
		const sid = str(t[0]);
		const files = arr(t[4]).map(str);
		const ops = arr(t[5]).map(str);
		const base = str(t[6]) || startOf.get(sid) || "";
		files.forEach((file, index) => {
			edits.push({
				sid,
				at: num(t[3]),
				path: resolvePath(file, base),
				op: ops[index] ?? "",
				ex: ex(sid, t[2], str(t[1])),
			});
		});
	}
	const editing = new Set(
		edits.filter((e) => !isScratch(e.path)).map((e) => e.sid),
	).size;
	const roots = [
		...new Set([
			...starts,
			...edits.flatMap((e) =>
				isScratch(e.path) ? [] : [markerRoot(e.path) ?? ""],
			),
		]),
	]
		.filter(Boolean)
		.sort((a, b) => b.length - a.length || a.localeCompare(b));
	const outsideBy = new Map<
		string,
		{ n: number; ex: string; roots: Set<string> }
	>();
	for (const edit of edits) {
		if (isScratch(edit.path)) continue;
		const start = startOf.get(edit.sid) ?? "";
		if (start && edit.path !== start && !edit.path.startsWith(`${start}/`)) {
			const seen = outsideBy.get(edit.sid) ?? {
				n: 0,
				ex: edit.ex,
				roots: new Set<string>(),
			};
			seen.n += 1;
			seen.roots.add(worktreeOf(edit.path, roots));
			outsideBy.set(edit.sid, seen);
		}
	}
	const outside = [...outsideBy]
		.map(([sid, o]) => ({ sid, n: o.n, ex: o.ex }))
		.sort((a, b) => b.n - a.n || a.sid.localeCompare(b.sid));
	const outsideRoots = count(
		[...outsideBy.values()].flatMap((o) => [...o.roots]),
		(root) => root,
	);
	const scriptDirs = new Map<
		string,
		{ sessions: Set<string>; files: Set<string>; ex: string }
	>();
	for (const edit of edits) {
		if (
			edit.op !== "write" ||
			!SCRIPT_FILE.test(edit.path) ||
			!isScratch(edit.path)
		)
			continue;
		const dir = edit.path.slice(0, edit.path.lastIndexOf("/"));
		const seen = scriptDirs.get(dir) ?? {
			sessions: new Set<string>(),
			files: new Set<string>(),
			ex: edit.ex,
		};
		seen.sessions.add(edit.sid);
		seen.files.add(edit.path);
		scriptDirs.set(dir, seen);
	}
	const scripts = [...scriptDirs]
		.filter(([, s]) => s.sessions.size >= 2)
		.map(([dir, s]) => ({
			dir,
			sessions: [...s.sessions].sort(),
			files: s.files.size,
			ex: s.ex,
		}))
		.sort(
			(a, b) =>
				b.sessions.length - a.sessions.length ||
				b.files - a.files ||
				a.dir.localeCompare(b.dir),
		);
	const deleted = new Map<string, number>();
	const recreated: EditFacts["recreated"] = [];
	for (const edit of [...edits].sort((a, b) => a.at - b.at)) {
		if (isScratch(edit.path)) continue;
		const key = `${edit.sid}|${edit.path}`;
		if (edit.op === "delete") deleted.set(key, edit.at);
		else if (edit.op === "write" && deleted.has(key)) {
			recreated.push({ file: edit.path, sid: edit.sid, ex: edit.ex });
			deleted.delete(key);
		}
	}
	return { editing, outside, outsideRoots, scripts, recreated };
}

function contextSection(
	usage: Row,
	contextSizes: readonly Row[],
	notRecorded: NotRecorded,
): DigestSection {
	const rows: DigestRow[] = [];
	const missing: string[] = [];
	for (const size of contextSizes) {
		const recorded = num(size.requests) - num(size.unrecorded);
		const q = arr(size.q).map(num);
		const stream = num(size.main_stream) ? "main" : "subagents";
		if (recorded <= 0) {
			missing.push(`context size ${str(size.source)} ${stream}: not recorded`);
			continue;
		}
		rows.push({
			metric: `context size ${str(size.source)} ${stream}`,
			value: `${fmt(recorded)} requests; p50 ${kilo(q[0] ?? 0)}, p90 ${kilo(q[1] ?? 0)}, p99 ${kilo(q[2] ?? 0)}, max ${kilo(num(size.largest))}; above p90 (${kilo(num(size.p90))}) in ${num(size.sessions_above)} sessions${num(size.unrecorded) ? `; ${fmt(num(size.unrecorded))} not recorded` : ""}`,
			definition:
				"deduplicated API usage events with a recorded size; size = context input tokens incl. cache; p90 = this cohort's",
			sessions: arr(size.ids).map(str),
		});
	}
	for (const source of notRecorded.sources)
		if (!contextSizes.some((size) => str(size.source) === source))
			missing.push(`context size ${source}: not recorded`);
	const compactions = tuples(usage.compactions);
	if (compactions.length) {
		const total = compactions.reduce((sum, t) => sum + num(t[3]), 0);
		const parts = compactions.map(
			(t) =>
				`${str(t[0])} ${num(t[1]) ? "main" : "sub"} ${str(t[2]) || (notRecorded.has(str(t[0]), "compact_trigger") ? "trigger not recorded" : "no trigger")} ${num(t[3])}`,
		);
		const top = [...compactions].sort((a, b) => num(b[4]) - num(a[4]))[0];
		rows.push({
			metric: "compactions",
			value: `${total}: ${parts.slice(0, 6).join("; ")}`,
			definition:
				"compaction events (Claude compact boundary, Codex compacted) by source, stream, run's trigger",
			sessions: [],
			example: str(top?.[5]),
		});
	} else missing.push("compactions: none recorded");
	const perSession = new Map(
		tuples(usage.per_session).map((t) => [
			str(t[0]),
			{
				runs: num(t[1]),
				tokens: num(t[2]),
				cost: num(t[3]),
				unpriced: num(t[4]),
				unknown: num(t[5]),
				turn: str(t[6]),
			},
		]),
	);
	const spans = new Map<string, Interval[]>();
	for (const t of tuples(usage.sub_spans)) {
		const sid = str(t[0]);
		spans.set(sid, [
			...(spans.get(sid) ?? []),
			{ t0: num(t[2]), t1: Math.max(num(t[2]), num(t[3])) },
		]);
	}
	const fanOut = [...spans]
		.map(([sid, list]) => ({
			sid,
			streams: list.length,
			peak: peakConcurrency(list),
			...(perSession.get(sid) ?? { tokens: 0, cost: 0, turn: "" }),
		}))
		.filter((s) => s.streams > 0);
	if (fanOut.length) {
		const top = topSessions(fanOut, (s) => s.peak * 1e12 + s.tokens, 1);
		rows.push({
			metric: "subagent fan-out",
			value: `${fanOut.length} sessions ran subagents (${fanOut.reduce((s, f) => s + f.streams, 0)} streams), ${fanOut.filter((f) => f.peak >= 2).length} ran 2+ at once; most at once: ${top
				.map(
					(s) =>
						`${s.sid.slice(0, 8)} peak ${s.peak}, ${s.streams} streams, ${kilo(s.tokens)} tokens, $${fmt(s.cost, 2)}`,
				)
				.join("; ")}`,
			definition:
				"subagent streams and Codex threads per session; peak = most with overlapping first-to-last run spans",
			sessions: top.map((s) => s.sid),
			example: top[0] ? `${top[0].sid}#${top[0].turn || 1}` : "",
		});
	} else missing.push("subagent fan-out: no subagent streams");
	const all = [...perSession].map(([sid, s]) => ({ sid, ...s }));
	if (all.length) {
		const tokens = all.reduce((s, x) => s + x.tokens, 0);
		const cost = all.reduce((s, x) => s + x.cost, 0);
		const unknown = all.reduce((s, x) => s + x.unknown, 0);
		const top = topSessions(all, (s) => s.tokens, 2);
		rows.push({
			metric: "largest sessions by token use",
			value: `${top.map((s) => `${s.sid.slice(0, 8)} ${kilo(s.tokens)} ($${fmt(s.cost, 2)})`).join(", ")}; all ${all.length} sessions ${kilo(tokens)} tokens, $${fmt(cost, 2)}${unknown ? `, ${unknown} runs without usage` : ""}`,
			definition:
				"sum of runs.tokens (input incl. cache, plus output) and cost_usd over all streams and Codex threads",
			sessions: top.map((s) => s.sid),
			example: top[0]?.turn ? `${top[0].sid}#${top[0].turn}` : "",
		});
	}
	return { id: "c", title: "Context and cost", rows, missing };
}

function timeSection(
	calls: Row,
	sessions: readonly Session[],
	notRecorded: NotRecorded,
): DigestSection {
	const rows: DigestRow[] = [];
	const missing: string[] = [];
	const tools = ranked(calls, "tools");
	const shellTimed = ranked(calls, "families").some(
		(family) => family.w > 0 && family.timed * 2 >= family.n,
	);
	if (tools.length && !shellTimed)
		rows.push({
			metric: "agent call time by tool",
			value: tools
				.slice(0, 3)
				.map(
					(t) => `${t.key} ${fmt(t.n)} calls ${minutes(t)} ${t.sessions} sess`,
				)
				.join("; "),
			definition: "agent calls (top-level or Codex script) by tool",
			sessions: tools[0]?.ids ?? [],
			example: tools[0]?.ex ?? "",
		});
	const timedFamilies = ranked(calls, "families").filter(
		(family) => family.w > 0 && family.timed * 2 >= family.n,
	);
	if (timedFamilies.length)
		rows.push({
			metric: "shell time by command family",
			value: timedFamilies
				.slice(0, 3)
				.map(
					(f) =>
						`${f.key} ${fmt(f.n)} calls ${fmt(f.f)} failed ${minutes(f)} ${f.sessions} sess`,
				)
				.join("; "),
			definition: "shell by repeated_commands family",
			sessions: timedFamilies[0]?.ids ?? [],
			example: timedFamilies[0]?.ex ?? "",
		});
	const busiest = ranked(calls, "families_n");
	const untimed = busiest.some((f) => f.timed < f.n * 0.9);
	if (busiest.length && (untimed || timedFamilies.length === 0))
		rows.push({
			metric: "most-run shell families",
			value: busiest
				.slice(0, 4)
				.map(
					(f) => `${f.key} ${fmt(f.n)} calls ${fmt(f.f)} failed ${minutes(f)}`,
				)
				.join("; "),
			definition:
				"shell by family, most calls; timed = calls with their own call_minutes",
			sessions: busiest[0]?.ids ?? [],
			example: busiest[0]?.ex ?? "",
		});
	const loops = ranked(calls, "loops").filter((loop) => loop.n >= 3);
	if (loops.length)
		rows.push({
			metric: "sleep, wait and poll",
			value: loops
				.map(
					(l) => `${l.key} ${fmt(l.n)} calls ${minutes(l)} ${l.sessions} sess`,
				)
				.join("; "),
			definition:
				"shell with sleep N, gh pr checks/run watch, --watch, until/while …; do; plus sleep/wait tools",
			sessions: loops[0]?.ids ?? [],
			example: loops[0]?.ex ?? "",
		});
	else missing.push("sleep and poll loops: none");
	const stopped = ranked(calls, "stopped");
	if (stopped.length)
		rows.push({
			metric: "killed or timed out",
			value: stopped
				.map(
					(s) =>
						`${s.key} ${fmt(s.n)} calls ${fmt(s.w, 1)} min ${s.sessions} sessions`,
				)
				.join("; "),
			definition:
				"calls their timeout stopped (timed_out = 1), or background tasks that ended killed or stopped",
			sessions: stopped[0]?.ids ?? [],
			example: stopped[0]?.ex ?? "",
		});
	else missing.push("killed or timed-out commands: none");
	for (const source of notRecorded.sources)
		if (notRecorded.has(source, "timed_out_calls"))
			missing.push(`call timeouts: not recorded for ${source}`);
	if (sessions.length) {
		const top = topSessions(sessions, (s) => s.wall, 2);
		const wall = sessions.reduce((s, x) => s + x.wall, 0);
		rows.push({
			metric: "top sessions by wall minutes",
			value: `${top.map((s) => `${s.sid.slice(0, 8)} ${fmt(s.wall)} min (${fmt(s.active)} active, ${s.mainRuns} runs)`).join(", ")}; all ${fmt(wall)} min`,
			definition:
				"sum of main-stream runs.minutes (first record to last activity); active = gaps capped at 5 min",
			sessions: top.map((s) => s.sid),
			example: ex(top[0]?.sid ?? "", top[0]?.longestTurn),
		});
	}
	return { id: "d", title: "Time sinks", rows, missing };
}

function routingSection(
	calls: Row,
	edits: EditFacts,
	patterns: readonly Row[],
): DigestSection {
	const rows: DigestRow[] = [];
	const missing: string[] = [];
	const routes = ranked(calls, "routes");
	const bases = ranked(calls, "edit_basis");
	const totalCalls = routes.reduce((s, r) => s + r.n, 0);
	if (routes.length)
		rows.push({
			metric: "file edits by route",
			value: `${routes
				.slice(0, 6)
				.map(
					(r) =>
						`${r.key} ${fmt(r.n)} calls, ${fmt(r.w)} file touches (${Math.round((100 * r.n) / Math.max(1, totalCalls))}% of calls, ${r.sessions} sess)`,
				)
				.join("; ")}; by basis: ${bases
				.map((b) => `${b.key} ${fmt(b.n)} calls, ${fmt(b.w)} file touches`)
				.join("; ")}`,
			definition:
				"successful calls (failed = 0) with changed_files, one route per call (calls.edit_route: edit tool, else an inline Python script's write, else the first matching shell pattern); calls = calls, file touches = paths of those calls (sum of length(changed_files)); basis = changed_files_basis (tool, shell or script), a call with paths of two bases counted under each",
			sessions: routes.find((r) => !r.key.startsWith("edit tool"))?.ids ?? [],
			example: routes.find((r) => !r.key.startsWith("edit tool"))?.ex ?? "",
		});
	else missing.push("file edits: none recorded");
	const inline = ranked(calls, "inline_all")[0];
	const scripts = ranked(calls, "inline_scripts");
	if (inline)
		rows.push({
			metric: "inline scripts",
			value: `${fmt(inline.n)} calls, ${inline.sessions} sessions, ${fmt(inline.w, 1)} min${
				scripts.length
					? `; same function in 3+ sessions: ${scripts
							.slice(0, 2)
							.map(
								(s) =>
									`"${short(s.key, 40)}" ${s.sessions} sess ${fmt(s.n)} calls`,
							)
							.join(", ")}`
					: ""
			}`,
			definition:
				"shell running python/node/bun/ruby/perl with -c, -e or a heredoc; grouped by first def/function signature",
			sessions: scripts[0]?.ids ?? [],
			example: scripts[0]?.ex ?? "",
		});
	if (edits.scripts.length)
		rows.push({
			metric: "script files written to scratch dirs",
			value: edits.scripts
				.slice(0, 3)
				.map((s) => `${s.dir} ${s.files} files ${s.sessions.length} sess`)
				.join("; "),
			definition:
				"whole-file writes of .py/.sh/.js/.ts/… under ~/.*, /tmp, /private or /var, by directory, 2+ sessions",
			sessions: (edits.scripts[0]?.sessions ?? []).slice(0, DIGEST_IDS),
			example: edits.scripts[0]?.ex ?? "",
		});
	rows.push(
		...patternRows(
			patterns,
			"wrong_route",
			1,
			"patterns wrong_route: hunted before editing, read and never used, or edits thrown away",
		),
	);
	return { id: "e", title: "Tool routing", rows, missing };
}

function checksSection(calls: Row, patterns: readonly Row[]): DigestSection {
	const rows: DigestRow[] = [];
	const missing: string[] = [];
	const checks = ranked(calls, "checks");
	if (checks.length)
		rows.push({
			metric: "local checks",
			value: checks
				.map(
					(c) =>
						`${c.key} ${fmt(c.n)} runs ${fmt(c.f)} failed ${minutes(c)} ${c.sessions} sess`,
				)
				.join("; "),
			definition:
				"shell by command_class (test, typecheck, lint, build, install)",
			sessions: checks[0]?.ids ?? [],
			example: checks[0]?.ex ?? "",
		});
	else missing.push("local checks: none ran");
	const poll = ranked(calls, "ci_polls")[0];
	const pushes = arr(calls.push_stats).map(num);
	if (poll || (pushes[0] ?? 0) > 0)
		rows.push({
			metric: "CI polling and pushes",
			value: `${poll ? `${fmt(poll.n)} polls, ${minutes(poll)}, ${poll.sessions} sess` : "no polls"}; ${fmt(pushes[0] ?? 0)} pushes in ${pushes[1] ?? 0} sess, CI ${(pushes[2] ?? 0) > 0 ? `linked for ${pushes[2]}, failed for ${pushes[3]}` : "outcome not recorded"}`,
			definition:
				"shell gh pr checks, gh run watch|view|list, gh pr view …checks; pushes = git_events push_range, CI = failed jobs on the pushed commit",
			sessions: poll?.ids ?? [],
			example: poll?.ex ?? "",
		});
	else missing.push("CI polling and pushes: none");
	rows.push(
		...patternRows(
			patterns,
			"incomplete",
			1,
			"patterns incomplete: no passing check after the last edit, or pushed as done then CI failed",
		),
	);
	return { id: "f", title: "Checks and CI", rows, missing };
}

function personSection(
	sessionsRow: Row,
	sessions: readonly Session[],
	patterns: readonly Row[],
): DigestSection {
	const rows: DigestRow[] = [
		...patternRows(
			patterns,
			"theme",
			4,
			"patterns theme: what the person keeps asking or reporting; drill for its prompts",
		),
		...patternRows(
			patterns,
			"correction",
			3,
			"patterns correction: what the person had to say again",
		),
	];
	const missing: string[] = [];
	const interrupts = sessions.filter((s) => s.interrupts > 0);
	const queued = sessions.filter((s) => s.queued > 0);
	const topInt = topSessions(interrupts, (s) => s.interrupts);
	rows.push({
		metric: "interrupts and prompts sent while working",
		value: `${fmt(sessions.reduce((s, x) => s + x.interrupts, 0))} interrupts in ${interrupts.length} sessions; ${fmt(sessions.reduce((s, x) => s + x.queued, 0))} queued prompts in ${queued.length} sessions${[
			...new Set(sessions.map((s) => s.source)),
		]
			.filter((source) => NO_QUEUED_PROMPTS.has(source))
			.map((source) => ` (queued: not recorded for ${source})`)
			.join("")}`,
		definition:
			"main stream interrupt markers, or a turn aborted as interrupted (Codex); queued = genuine prompts typed while the agent worked",
		sessions: topInt.map((s) => s.sid),
		example: ex(topInt[0]?.sid ?? "", topInt[0]?.firstTurn),
	});
	const counts = sessions.map((s) => s.genuine).sort((a, b) => a - b);
	const topAsk = topSessions(sessions, (s) => s.genuine);
	rows.push({
		metric: "prompts per session",
		value: `${fmt(counts.reduce((s, n) => s + n, 0))} prompts; p50 ${quantile(counts, 0.5)}, p90 ${quantile(counts, 0.9)}, max ${counts.at(-1) ?? 0}`,
		definition:
			"genuine main-stream prompts per session (queued in, delegations out)",
		sessions: topAsk.map((s) => s.sid),
		example: ex(topAsk[0]?.sid ?? "", topAsk[0]?.firstTurn),
	});
	const repeats = tuples(sessionsRow.repeats);
	const totals = arr(sessionsRow.repeat_totals).map(num);
	const reasks = sessions.reduce((s, x) => s + x.reasks, 0);
	rows.push({
		metric: "repeated requests",
		value: `${fmt(totals[0] ?? 0)} prompt texts sent 2+ times in ${totals[1] ?? 0} sessions${repeats[0] ? ` (e.g. "${short(str(repeats[0][0]), 25)}" ×${num(repeats[0][1])})` : ""}; re-asks ${reasks}`,
		definition:
			"same genuine prompt text (lowercased, 12+ chars) 2+ times in one session; re-asks = runs.reasked",
		sessions: [...new Set(repeats.map((t) => str(t[2])))].slice(0, DIGEST_IDS),
		example: repeats[0] ? ex(str(repeats[0][2]), repeats[0][3]) : "",
	});
	return { id: "g", title: "The person", rows, missing };
}

function agentsSection(
	sessionsRow: Row,
	sessions: readonly Session[],
): DigestSection {
	const rows: DigestRow[] = [];
	const missing: string[] = [];
	const mix = count(
		sessions,
		(s) => `${s.source} ${s.launcher || "(launcher not recorded)"}`,
	);
	rows.push({
		metric: "sessions by source and launcher",
		value: mix.map(([key, n]) => `${key} ${n}`).join("; "),
		definition:
			"sessions by source and first entrypoint/originator (codex_exec = non-interactive, a script or agent started it)",
		sessions: [],
	});
	const links = tuples(sessionsRow.links);
	const inCohort = new Set(sessions.map((s) => s.sid));
	const launched = links.filter(
		(t) => str(t[0]) === "delegation" && inCohort.has(str(t[2])),
	);
	const launching = links.filter(
		(t) => str(t[0]) === "delegation" && inCohort.has(str(t[1])),
	);
	if (launched.length || launching.length)
		rows.push({
			metric: "launched by another agent",
			value: `${new Set(launched.map((t) => str(t[2]))).size} sessions were started by another agent's session; ${new Set(launching.map((t) => str(t[1]))).size} sessions started ${launching.length} others`,
			definition:
				"session_links delegation: one agent's session started by the other agent",
			sessions: [...new Set(launched.map((t) => str(t[2])))].slice(
				0,
				DIGEST_IDS,
			),
		});
	else missing.push("delegation links: none recorded");
	const streams = tuples(sessionsRow.streams);
	const threads = links.filter(
		(t) => str(t[0]) === "parent_thread" && inCohort.has(str(t[1])),
	);
	const withStreams = count(streams, (t) => str(t[0]));
	rows.push({
		metric: "subagents",
		value: `Claude subagent streams ${streams.length} in ${withStreams.length} sessions; Codex subagent threads ${threads.length ? `${threads.length} in ${new Set(threads.map((t) => str(t[1]))).size} sessions` : "none linked"}`,
		definition:
			"runs.agent_id streams; Codex threads = session_links parent_thread",
		sessions: withStreams.slice(0, DIGEST_IDS).map(([sid]) => sid),
		example: streams[0]
			? ex(str(streams[0][0]), streams[0][2], str(streams[0][1]))
			: "",
	});
	const models = tuples(sessionsRow.models);
	if (models.length)
		rows.push({
			metric: "models",
			value: models
				.slice(0, 3)
				.map(
					(t) =>
						`${str(t[0]) || "(not recorded)"} ${fmt(num(t[1]))} runs ${num(t[2])} sess`,
				)
				.join("; "),
			definition: "runs by runs.model (the run's first model), all streams",
			sessions: [],
		});
	return { id: "h", title: "Agents", rows, missing };
}

const SEVERITY_TITLES: Readonly<Record<string, string>> = {
	destructive: "destructive commands",
	production: "production-looking writes or deploys",
	secrets: "credential or secret exposure",
	lost_work: "reverted or lost work",
};

const SEVERITY_DEFINITIONS: Readonly<Record<string, string>> = {
	destructive:
		"heuristic, full shell text (not grep/echo): rm -rf of a non-/tmp target, git push --force, reset --hard, clean -fd, DROP/TRUNCATE or WHERE-less DELETE to a DB client",
	production:
		"heuristic: deploy/publish commands (vercel --prod, kubectl apply, npm publish…), or a prod-named host/env/db with a SQL write or deploy",
	secrets:
		"heuristic: key formats (sk-, ghp_, github_pat_, AKIA, xox, private key, JWT) in a command or output; *.env reads",
	lost_work:
		"git checkout -- / restore (not --staged), revert, stash drop|clear; files a session deleted then wrote again",
};

interface SeverityHit {
	category: string;
	rule: string;
	n: number;
	sessions: number;
	examples: { ex: string; quote: string }[];
}

export function mergeSeverity(shards: readonly Row[]): SeverityHit[] {
	const byRule = new Map<string, SeverityHit>();
	for (const shard of shards)
		for (const t of tuples(shard.severity)) {
			const key = `${str(t[0])}|${str(t[1])}`;
			const seen = byRule.get(key) ?? {
				category: str(t[0]),
				rule: str(t[1]),
				n: 0,
				sessions: 0,
				examples: [],
			};
			seen.n += num(t[2]);
			seen.sessions += num(t[3]);
			seen.examples.push(
				...tuples(t[4]).map((e) => ({ ex: str(e[0]), quote: str(e[1]) })),
			);
			byRule.set(key, seen);
		}
	const order = (left: string, right: string) =>
		left < right ? -1 : left > right ? 1 : 0;
	return [...byRule.values()]
		.sort(
			(left, right) =>
				order(left.category, right.category) || order(left.rule, right.rule),
		)
		.map((hit) => ({
			...hit,
			examples: hit.examples
				.sort(
					(a, b) => a.ex.localeCompare(b.ex) || a.quote.localeCompare(b.quote),
				)
				.slice(0, 50),
		}));
}

function severitySection(
	severity: readonly Row[],
	edits: EditFacts,
): DigestSection {
	const hits = mergeSeverity(severity);
	if (edits.recreated.length)
		hits.push({
			category: "lost_work",
			rule: "file deleted then written again",
			n: edits.recreated.length,
			sessions: new Set(edits.recreated.map((r) => r.sid)).size,
			examples: edits.recreated.map((r) => ({
				ex: r.ex,
				quote: r.file.split("/").slice(-2).join("/"),
			})),
		});
	const rows: DigestRow[] = [];
	const missing: string[] = [];
	for (const category of Object.keys(SEVERITY_TITLES)) {
		const found = hits.filter((hit) => hit.category === category);
		if (!found.length) {
			missing.push(`${SEVERITY_TITLES[category]}: none matched`);
			continue;
		}
		const examples = [...found]
			.sort((a, b) => b.n - a.n || a.rule.localeCompare(b.rule))
			.flatMap((hit) =>
				hit.examples.slice(0, 1).map((e) => ({ ...e, rule: hit.rule })),
			);
		rows.push({
			metric: SEVERITY_TITLES[category] as string,
			value: `${found.map((hit) => `${hit.rule} ${fmt(hit.n)} (${hit.sessions} sess)`).join("; ")}; e.g. ${examples
				.slice(0, 1)
				.map((e) => `${e.ex} "${short(e.quote.trim(), 40)}"`)
				.join(" · ")}`,
			definition: SEVERITY_DEFINITIONS[category] as string,
			sessions: [],
		});
	}
	return {
		id: "i",
		title: "Severity (every occurrence, not ranked; regexes are heuristics)",
		rows,
		missing,
	};
}

interface RunFact {
	readonly rid: string;
	readonly sid: string;
	readonly aid: string;
	readonly turn: number;
	readonly minutes: number;
	readonly active: number;
	readonly frustrated: boolean;
	readonly reasked: boolean;
	readonly failed: number;
	readonly sorted: number;
	readonly quote: string;
	readonly chars: number;
	readonly kind: string;
}

export interface Coverage {
	readonly frustrated: { readonly explained: number; readonly total: number };
	readonly failed: { readonly explained: number; readonly total: number };
	readonly active: { readonly explained: number; readonly total: number };
}

export function joinDigestRuns(row: Row): Row {
	const byRun = (value: unknown) =>
		new Map(tuples(value).map((t) => [str(t[0]), t]));
	const failures = byRun(row.failures);
	const asked = byRun(row.asked);
	return {
		runs: tuples(row.runs).map((t) => {
			const f = failures.get(str(t[0]));
			const a = asked.get(str(t[0]));
			return [
				...t,
				f?.[1] ?? 0,
				f?.[2] ?? 0,
				a?.[1] ?? "",
				a?.[2] ?? 0,
				a?.[3] ?? "",
			];
		}),
	};
}

export function coverageOf(runs: readonly RunFact[], patterns: readonly Row[]) {
	const covered = new Set(patterns.flatMap((row) => arr(row.rids).map(str)));
	const themed = new Set(
		patterns
			.filter((row) => str(row.kind) === "theme")
			.flatMap((row) => arr(row.rids).map(str)),
	);
	const next = new Map<string, RunFact>();
	const streams = new Map<string, RunFact[]>();
	for (const run of runs)
		streams.set(`${run.sid}|${run.aid}`, [
			...(streams.get(`${run.sid}|${run.aid}`) ?? []),
			run,
		]);
	for (const list of streams.values()) {
		list.sort((a, b) => a.turn - b.turn);
		list.forEach((run, index) => {
			const after = list[index + 1];
			if (after) next.set(run.rid, after);
		});
	}
	const upset = runs.filter((run) => run.frustrated || run.reasked);
	const upsetExplained = upset.filter(
		(run) => covered.has(run.rid) || covered.has(next.get(run.rid)?.rid ?? ""),
	);
	const failedTotal = runs.reduce((sum, run) => sum + run.failed, 0);
	const failedExplained = runs.reduce(
		(sum, run) => sum + (covered.has(run.rid) ? run.failed : run.sorted),
		0,
	);
	const activeTotal = runs.reduce((sum, run) => sum + run.active, 0);
	const activeExplained = runs.reduce(
		(sum, run) => sum + (covered.has(run.rid) ? run.active : 0),
		0,
	);
	return {
		covered,
		themed,
		next,
		upset: upset.filter((run) => !upsetExplained.includes(run)),
		coverage: {
			frustrated: { explained: upsetExplained.length, total: upset.length },
			failed: { explained: failedExplained, total: failedTotal },
			active: {
				explained: Math.round(activeExplained),
				total: Math.round(activeTotal),
			},
		} satisfies Coverage,
	};
}

const quoted = (run: RunFact | undefined, max = 55) =>
	run
		? `${ex(run.sid, run.turn, run.aid)}${run.quote ? ` "${short(run.quote.trim(), max)}"` : ""}`
		: "";

function unexplainedSection(
	runsRow: Row,
	patterns: readonly Row[],
	queuedRecorded: boolean,
): { section: DigestSection; coverage: Coverage } {
	const runs: RunFact[] = tuples(runsRow.runs).map((t) => ({
		rid: str(t[0]),
		sid: str(t[1]),
		aid: str(t[2]),
		turn: num(t[3]),
		minutes: num(t[4]),
		active: num(t[5]),
		frustrated: num(t[6]) === 1,
		reasked: num(t[7]) === 1,
		failed: num(t[8]),
		sorted: num(t[9]),
		quote: str(t[10]),
		chars: num(t[11]),
		kind: str(t[12]),
	}));
	const { covered, themed, next, upset, coverage } = coverageOf(runs, patterns);
	const rows: DigestRow[] = [
		{
			metric: "coverage",
			value: `frustrated prompts and re-asks ${coverage.frustrated.explained}/${coverage.frustrated.total} (${pct(coverage.frustrated.explained, coverage.frustrated.total)}); failed agent calls ${fmt(coverage.failed.explained)}/${fmt(coverage.failed.total)} (${pct(coverage.failed.explained, coverage.failed.total)}); active minutes ${fmt(coverage.active.explained)}/${fmt(coverage.active.total)} (${pct(coverage.active.explained, coverage.active.total)})`,
			definition:
				"explained = in a run a listed pattern cites (for a prompt: its run or the run it reacts to); failed calls also when refused, timed out, killed, a check or install",
			sessions: [],
		},
	];
	const missing: string[] = [];
	if (upset.length)
		rows.push({
			metric: "frustrated prompts and re-asks no pattern explains",
			value: `${upset.length}: ${upset
				.slice(0, 2)
				.map((run) => quoted(next.get(run.rid) ?? run, 32))
				.join(" · ")}`,
			definition:
				"runs.frustrated or reasked, neither it nor the next run cited by a pattern; quoted: the next prompt",
			sessions: [],
		});
	const main = runs.filter((run) => run.aid === "");
	const longCut = quantile(
		main.map((run) => run.minutes).sort((a, b) => a - b),
		0.9,
	);
	const long = main
		.filter((run) => run.minutes >= longCut && !covered.has(run.rid))
		.sort((a, b) => b.minutes - a.minutes || a.rid.localeCompare(b.rid));
	if (long.length)
		rows.push({
			metric: "long runs no pattern covers",
			value: `${long.length} at or above p90 (${fmt(longCut, 1)} min): ${long
				.slice(0, 2)
				.map((run) => `${quoted(run, 25)} ${fmt(run.minutes)} min`)
				.join(" · ")}`,
			definition:
				"main-stream runs, runs.minutes at or above this cohort's p90, no pattern cites",
			sessions: [],
		});
	const failedBy = new Map<string, number>();
	for (const run of runs)
		if (!covered.has(run.rid) && run.failed > run.sorted)
			failedBy.set(
				run.sid,
				(failedBy.get(run.sid) ?? 0) + run.failed - run.sorted,
			);
	const failedTop = [...failedBy].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	);
	if (failedTop.length) {
		const lead = runs
			.filter((run) => run.sid === failedTop[0]?.[0] && !covered.has(run.rid))
			.sort((a, b) => b.failed - b.sorted - (a.failed - a.sorted))[0];
		rows.push({
			metric: "failed calls no pattern or row explains",
			value: `${fmt(failedTop.reduce((sum, [, n]) => sum + n, 0))} in ${failedTop.length} sessions; most: ${failedTop
				.slice(0, 4)
				.map(([sid, n]) => `${sid.slice(0, 8)} ${n}`)
				.join(", ")}`,
			definition:
				"failed agent calls in runs no pattern cites, other than refusals, timeouts, kills, checks, installs",
			sessions: failedTop.slice(0, DIGEST_IDS).map(([sid]) => sid),
			example: lead ? ex(lead.sid, lead.turn, lead.aid) : "",
		});
	}
	const prompts = main.filter((run) => run.quote !== "");
	const lengthCut = quantile(
		prompts.map((run) => run.chars).sort((a, b) => a - b),
		0.95,
	);
	const unthemed = prompts.filter(
		(run) =>
			(run.chars >= lengthCut || run.kind === "queued") && !themed.has(run.rid),
	);
	if (unthemed.length) {
		const longOnes = unthemed.filter((run) => run.chars >= lengthCut);
		const steering = unthemed.filter((run) => run.kind === "queued");
		rows.push({
			metric: "long or steering prompts no theme covers",
			value: `${longOnes.length} at or above p95 length (${fmt(lengthCut)} chars), ${queuedRecorded ? `${steering.length} queued while working` : "queued not recorded"}: ${[
				...new Set([...longOnes.slice(0, 1), ...steering.slice(0, 1)]),
			]
				.map((run) => quoted(run, 28))
				.join(" · ")}`,
			definition:
				"genuine main-stream prompts at/above this cohort's p95 length, or queued, in runs no theme cites",
			sessions: [],
		});
	}
	if (!runs.length) missing.push("runs: none");
	return {
		section: {
			id: "j",
			title: "Unexplained (what no row or pattern above accounts for)",
			rows,
			missing,
		},
		coverage,
	};
}

export function buildDigest(
	inputs: DigestInputs,
	scope: Digest["scope"],
): Digest {
	const sessions = sessionsOf(inputs.sessions, inputs.startDirs);
	const edits = editFacts(inputs.edits, sessions);
	const bySource = Object.fromEntries(count(sessions, (s) => s.source));
	const notRecorded = notRecordedOf(inputs.sessions, inputs.calls);
	const unexplained = unexplainedSection(
		inputs.runs,
		inputs.patterns,
		sessions.some((s) => !NO_QUEUED_PROMPTS.has(s.source)),
	);
	return {
		scope,
		sessions: sessions.length,
		bySource,
		notRecorded: notRecorded.bySource,
		coverage: unexplained.coverage,
		sections: [
			setupSection(sessions, inputs.calls, edits),
			failuresSection(inputs.calls, inputs.patterns),
			contextSection(inputs.usage, inputs.contextSizes, notRecorded),
			timeSection(inputs.calls, sessions, notRecorded),
			routingSection(inputs.calls, edits, inputs.patterns),
			checksSection(inputs.calls, inputs.patterns),
			personSection(inputs.sessions, sessions, inputs.patterns),
			agentsSection(inputs.sessions, sessions),
			severitySection(inputs.severity, edits),
			unexplained.section,
		].map(maskSection),
	};
}

function maskSection(section: DigestSection): DigestSection {
	return {
		...section,
		rows: section.rows.map((row) => ({
			...row,
			metric: maskSecrets(row.metric),
			value: maskSecrets(row.value),
		})),
		missing: section.missing.map(maskSecrets),
	};
}

export const DIGEST_UNITS =
	"Rows: metric: value [definition, quote it with the number] e.g. session#turn (or session:agent#turn) to read. Terms: session = main session started in the window; streams = main + subagents unless said; shell = shell commands matched on their first 300 chars; min = sum of call_minutes (call to result); failed = error, non-zero exit or refusal.";

export type DigestPart =
	| "calls"
	| "edits"
	| "usage"
	| "runs"
	| "facts"
	| "severity"
	| "patterns";

const SECTION_READS: Readonly<Record<string, readonly DigestPart[]>> = {
	a: ["calls", "edits"],
	b: ["calls", "patterns"],
	c: ["usage", "facts", "calls"],
	d: ["calls", "facts"],
	e: ["calls", "edits", "patterns"],
	f: ["calls", "patterns"],
	g: ["facts", "patterns"],
	h: ["facts"],
	i: ["severity", "edits"],
	j: ["runs", "patterns"],
};

export function markUnknown(
	digest: Digest,
	unknown: ReadonlyMap<DigestPart, readonly string[]>,
): Digest {
	if (unknown.size === 0) return digest;
	return {
		...digest,
		sections: digest.sections.map((section) => {
			const reads = SECTION_READS[section.id] ?? [];
			const refused = reads.filter((part) => unknown.has(part));
			if (refused.length === 0) return section;
			const lines = refused.flatMap((part) =>
				(unknown.get(part) ?? []).map(
					(line) =>
						`unknown, not 0: ${line.replace(/^partial: /u, "")}${part === "patterns" ? "; patterns of that family are missing from these rows" : ""}`,
				),
			);
			return {
				...section,
				rows: refused.every((part) => part === "patterns") ? section.rows : [],
				missing: [...lines, ...section.missing],
			};
		}),
	};
}

export function noteMerged(digest: Digest, notes: readonly string[]): Digest {
	if (notes.length === 0) return digest;
	const note = `; ${notes.join("; ")}`;
	return {
		...digest,
		sections: digest.sections.map((section) =>
			section.id === "j"
				? {
						...section,
						rows: section.rows.map((row) => ({
							...row,
							definition: `${row.definition}${note}`,
						})),
					}
				: section,
		),
	};
}

export function renderDigest(
	digest: Digest,
	ms?: number,
	footer: readonly string[] = [],
): string {
	const scope = digest.scope;
	const head = `retro digest ${scope.repository ?? "all repositories"} ${scope.from}..${scope.to}${scope.latest ? ` latest ${scope.latest}` : ""}${scope.listed ? ` (${scope.listed} listed sessions)` : ""}: ${digest.sessions} sessions (${Object.entries(
		digest.bySource,
	)
		.map(([source, n]) => `${source} ${n}`)
		.join(", ")})${ms === undefined ? "" : `, ${fmt(ms / 1000, 1)} s`}`;
	const observed = Object.entries(digest.notRecorded)
		.map(
			([source, facts]) =>
				`${source}: ${facts.length ? facts.join(", ") : "nothing (every row is recorded)"}`,
		)
		.join("; ");
	const lines = [
		head,
		DIGEST_UNITS,
		`Not recorded (never shown as 0): ${observed || "n/a"}. This maps what is measured; the biggest problem may be outside it.`,
	];
	for (const section of digest.sections) {
		lines.push(`## ${section.id}. ${section.title}`);
		let previous = "";
		for (const row of section.rows) {
			const example = row.example
				? ` e.g. ${row.example}`
				: row.sessions.length
					? ` ids ${row.sessions.map((sid) => sid.slice(0, 8)).join(" ")}`
					: "";
			const definition =
				row.definition === previous ? "as above" : row.definition;
			previous = row.definition;
			lines.push(`- ${row.metric}: ${row.value} [${definition}]${example}`);
		}
		for (const note of section.missing) lines.push(`- skipped: ${note}`);
	}
	return [...lines, ...footer].join("\n");
}
