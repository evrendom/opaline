import type {
	AnalysisFindOutput,
	AnalysisTrace,
	RunRef,
} from "@rudel/api-routes";
import { WEEKLY_MEASURES, WEEKLY_NULLABLE_MEASURES } from "@rudel/api-routes";
import {
	compactList,
	omittedMarker,
	truncateString,
	type Verbosity,
} from "./compact.js";
import { cell } from "./read-output.js";

const SHARED_MIN_CHARS = 40;
const NEVER_SHARED = new Set(["ref", "eventRef", "originRef", "key"]);

interface ListCell {
	readonly list: readonly string[];
}

interface Column<T> {
	readonly name: string;
	readonly value: (row: T) => unknown;
	readonly free?: true;
}

interface Table {
	readonly headers: readonly string[];
	readonly rows: readonly (readonly unknown[])[];
}

interface Layout {
	readonly head: readonly string[];
	readonly main: Table;
	readonly after: readonly (string | Table)[];
	readonly omittedColumns: readonly string[];
}

type GitEvent = Extract<
	AnalysisFindOutput,
	{ source: "git" }
>["events"][number];

function list(items: readonly string[]): ListCell {
	return { list: items };
}

function isList(value: unknown): value is ListCell {
	return typeof value === "object" && value !== null && "list" in value;
}

function capped(value: unknown): unknown {
	if (isList(value)) return compactList(value.list);
	return typeof value === "string" ? truncateString(value) : value;
}

function columns<T>(
	all: readonly Column<T>[],
	rows: readonly T[],
	verbosity: Verbosity,
	omitted: string[],
): Table {
	const shown =
		verbosity === "summary" ? all.filter((column) => !column.free) : all;
	if (verbosity === "summary")
		omitted.push(...all.filter((column) => column.free).map((c) => c.name));
	return {
		headers: shown.map((column) => column.name),
		rows: rows.map((row) => shown.map((column) => capped(column.value(row)))),
	};
}

function plain(headers: readonly string[], rows: readonly unknown[][]): Table {
	return { headers, rows: rows.map((row) => row.map(capped)) };
}

class SharedValues {
	private readonly keys = new Map<string, string>();
	private readonly entries: (readonly [string, string, number, string])[] = [];

	share(table: Table): Table {
		const counts = new Map<string, number>();
		for (const row of table.rows)
			row.forEach((value, index) => {
				if (
					typeof value !== "string" ||
					value.length < SHARED_MIN_CHARS ||
					NEVER_SHARED.has(table.headers[index] ?? "")
				)
					return;
				const id = `${table.headers[index]}\u0000${value}`;
				counts.set(id, (counts.get(id) ?? 0) + 1);
			});
		return {
			headers: table.headers,
			rows: table.rows.map((row) =>
				row.map((value, index) => {
					if (typeof value !== "string") return value;
					const column = table.headers[index] ?? "";
					const id = `${column}\u0000${value}`;
					const repeats = counts.get(id) ?? 0;
					if (repeats < 2) return value;
					let key = this.keys.get(id);
					if (!key) {
						key = `v${this.keys.size + 1}`;
						this.keys.set(id, key);
						this.entries.push([key, column, repeats, value]);
					}
					return `=${key}`;
				}),
			),
		};
	}

	lines(): string[] {
		if (this.entries.length === 0) return [];
		return [
			"shared values: a cell =vN repeats value vN",
			table(["key", "column", "rows", "value"], this.entries),
		];
	}
}

function layout(output: AnalysisFindOutput, verbosity: Verbosity): Layout {
	const omitted: string[] = [];
	const done = (
		main: Table,
		after: (string | Table)[] = [],
		head: string[] = [],
	): Layout => ({ head, main, after, omittedColumns: omitted });
	if ("sessions" in output) {
		const totals = output.sessionTotals;
		return done(
			plain(
				[
					"sessionId",
					"repository",
					"agent",
					"startedAt",
					"rows",
					"firstSeen",
					"lastSeen",
					"groupRunTime",
					"groupCallTime",
					"failedCalls",
					"example",
					"parentSessionId",
				],
				output.sessions.map((session) => [
					session.sessionId,
					session.repository,
					session.agent,
					session.startedAt,
					session.rows,
					session.firstSeen,
					session.lastSeen,
					session.groupRunTime,
					session.groupCallTime,
					session.failedCalls,
					`${refText(session.example.ref)}@${session.example.record}`,
					session.parentSessionId,
				]),
			),
			[],
			[
				`sessions behind the rows: sessions=${totals.sessions} rows=${totals.rows} firstSeen=${totals.firstSeen ?? "none"} lastSeen=${totals.lastSeen ?? "none"}`,
			],
		);
	}
	if (output.source === "runs") {
		if ("rows" in output)
			return done(
				columns(
					[
						{ name: "ref", value: (row) => refText(row.ref) },
						{ name: "startedAt", value: (row) => row.startedAt },
						{ name: "minutes", value: (row) => row.minutes },
						{ name: "activeMinutes", value: (row) => row.activeMinutes },
						{ name: "costUsd", value: (row) => row.costUsd },
						{ name: "model", value: (row) => row.model },
						{ name: "models", value: (row) => row.models.join(",") },
						{ name: "repository", value: (row) => row.repository },
						{ name: "agent", value: (row) => row.agent },
						{ name: "edits", value: (row) => row.edits },
						{ name: "toolCalls", value: (row) => row.toolCalls },
						{ name: "failedCalls", value: (row) => row.failedCalls },
						{ name: "readCalls", value: (row) => row.readCalls },
						{ name: "searchCalls", value: (row) => row.searchCalls },
						{ name: "notFound", value: (row) => row.notFound },
						{ name: "nextReaction", value: (row) => row.nextReaction },
						{ name: "rawChars", value: (row) => row.rawChars },
						{ name: "parentSessionId", value: (row) => row.parentSessionId },
						{ name: "depth", value: (row) => row.depth },
						{ name: "promptHead", value: (row) => row.promptHead, free: true },
					],
					output.rows,
					verbosity,
					omitted,
				),
			);
		return done(
			plain(
				["key", "runs", "sessions", "minutes", "activeMinutes", "costUsd"],
				output.groups.map((group) => [
					group.key,
					group.runs,
					group.sessions,
					group.minutes,
					group.activeMinutes,
					group.costUsd,
				]),
			),
		);
	}
	if (output.source === "tool")
		return done(
			columns(
				[
					{ name: "toolGroup", value: (group) => group.toolGroup },
					{ name: "cause", value: (group) => group.cause },
					{ name: "detail", value: (group) => group.detail },
					{ name: "kind", value: (group) => group.kind },
					{ name: "count", value: (group) => group.count },
					{ name: "sessions", value: (group) => group.sessions },
					{ name: "firstSeen", value: (group) => group.firstSeen },
					{ name: "lastSeen", value: (group) => group.lastSeen },
					{
						name: "topCommands",
						value: (group) => list(group.topCommands),
						free: true,
					},
					{ name: "minutes", value: (group) => group.minutes },
					{ name: "costUsd", value: (group) => group.costUsd },
					{
						name: "examples",
						value: (group) => list(failureExamples(group.examples)),
						free: true,
					},
				],
				output.groups,
				verbosity,
				omitted,
			),
		);
	if (output.source === "calls") {
		if ("rows" in output)
			return done(
				columns(
					[
						{
							name: "ref",
							value: (row) => `${refText(row.ref)}@${row.record}.${row.block}`,
						},
						{ name: "at", value: (row) => row.at },
						{ name: "agent", value: (row) => row.agent },
						{ name: "tool", value: (row) => row.tool },
						{
							name: "from",
							value: (row) =>
								row.filePath
									? `${row.commandFrom} ${row.filePath}`
									: row.commandFrom,
						},
						{ name: "failed", value: (row) => row.failed },
						{ name: "exitCode", value: (row) => row.exitCode },
						{ name: "callMinutes", value: (row) => row.callMinutes },
						{ name: "argv0", value: (row) => row.commandArgv0 },
						{ name: "prefix", value: (row) => row.commandPrefix },
						{ name: "fingerprint", value: (row) => row.commandFingerprint },
						{ name: "simhash", value: (row) => row.commandSimhash },
						{ name: "chars", value: (row) => row.commandChars },
						{ name: "parentSessionId", value: (row) => row.parentSessionId },
						{ name: "command", value: (row) => row.command, free: true },
					],
					output.rows,
					verbosity,
					omitted,
				),
			);
		return done(
			columns(
				[
					{ name: "key", value: (group) => group.key },
					{ name: "calls", value: (group) => group.calls },
					{ name: "sessions", value: (group) => group.sessions },
					{ name: "failedCalls", value: (group) => group.failedCalls },
					{ name: "groupCallTime", value: (group) => group.groupCallTime },
					{ name: "groupRunTime", value: (group) => group.groupRunTime },
					{ name: "firstSeen", value: (group) => group.firstSeen },
					{ name: "lastSeen", value: (group) => group.lastSeen },
					{ name: "normalized", value: (group) => group.normalized },
					{
						name: "examples",
						value: (group) =>
							list(
								group.examples.map(
									(example) =>
										`${refText(example.ref)}@${example.record}.${example.block}${subagentOf(example.parentSessionId)} ${example.commandFrom}: ${example.command}`,
								),
							),
						free: true,
					},
				],
				output.groups,
				verbosity,
				omitted,
			),
		);
	}
	if (output.source === "git")
		return done(
			columns(gitColumns, output.events, verbosity, omitted),
			output.witnesses?.length
				? [
						"witnesses: retained edges whose evidence row is not readable",
						plain(
							["session", "at", "relation", "matched", "evidence", "reason"],
							output.witnesses.map((witness) => [
								`${witness.sessionId}/${witness.agentId || "main"}${witness.turn === null ? " (no run)" : ` turn ${witness.turn}`}`,
								witness.at,
								witness.relation,
								witness.matchedValue,
								`${witness.evidenceId}@${witness.generation.revision}/${witness.generation.parserVersion}`,
								witness.reason,
							]),
						),
					]
				: [],
			linksLine(output.events),
		);
	if (output.source === "weekly") {
		const measures = [...WEEKLY_MEASURES, ...WEEKLY_NULLABLE_MEASURES];
		return done(
			plain(
				["week", "member", "agent", "weeks", "sessions", ...measures],
				output.totals.map((total) => [
					total.week,
					total.member,
					total.agent,
					total.weeks,
					total.sessions,
					...measures.map((measure) => total[measure]),
				]),
			),
			[],
			output.snapshot
				? [
						`snapshot ${output.snapshot.id} refreshedAt=${output.snapshot.refreshedAt}`,
					]
				: [],
		);
	}
	return done(
		columns(
			[
				{ name: "type", value: (event) => event.type },
				{ name: "terms", value: (event) => event.terms.join("; ") },
				{
					name: "eventRef",
					value: (event) =>
						`${refText(event.eventRef)}@${event.eventRef.record}`,
				},
				{
					name: "originRef",
					value: (event) => (event.originRef ? refText(event.originRef) : null),
				},
				{ name: "originMinutes", value: (event) => event.originMinutes },
				{ name: "originCostUsd", value: (event) => event.originCostUsd },
				{ name: "partial", value: (event) => event.partial },
				{ name: "parentSessionId", value: (event) => event.parentSessionId },
				{ name: "quote", value: (event) => event.quote, free: true },
			],
			output.events,
			verbosity,
			omitted,
		),
		[
			plain(
				["type", "count", "sessions"],
				output.groups.map((group) => [group.type, group.count, group.sessions]),
			),
		],
	);
}

const gitColumns: readonly Column<GitEvent>[] = [
	{ name: "ref", value: gitEventAddress },
	{ name: "at", value: (event) => event.at },
	{ name: "kind", value: (event) => event.kind },
	{ name: "label", value: (event) => event.label },
	{
		name: "literal",
		value: (event) =>
			[
				event.call && `call=${event.call}`,
				event.branch && `branch=${event.branch}`,
				event.sourceBranch && `from=${event.sourceBranch}`,
				event.shortSha && `commit=${event.shortSha}`,
				event.kind === "push_range" &&
					`push=${event.pushFrom || "new"}..${event.pushTo || "new"}`,
				event.remote && `remote=${event.remote}`,
				event.prRepo && `repo=${event.prRepo}`,
				event.prNumber !== null && `pr=${event.prNumber}`,
				event.runId && `run=${event.runId}`,
				event.baseCommit && `base=${event.baseCommit}`,
				event.commitHash && `head=${event.commitHash}`,
			]
				.filter(Boolean)
				.join(" "),
	},
	{
		name: "generation",
		value: (event) =>
			event.generation
				? `${event.generation.revision}/${event.generation.parserVersion}${event.generation.current ? "" : " not-current"}`
				: null,
	},
	{
		name: "repository",
		value: (event) =>
			event.repository
				? `${event.repository.fullName} id=${event.repository.id} (${event.repository.basis}: ${event.repository.value})`
				: null,
	},
	{
		name: "github",
		value: (event) =>
			[
				event.github.status,
				event.github.reason && `reason=${event.github.reason}`,
				event.github.prFrom && `prFrom=${event.github.prFrom}`,
				event.github.ciFrom && `ciFrom=${event.github.ciFrom}`,
				event.github.coveredThrough &&
					`coveredThrough=${event.github.coveredThrough}`,
				linksCell(event.edges),
			]
				.filter(Boolean)
				.join(" "),
	},
	{
		name: "sha",
		value: (event) =>
			event.sha
				? `${event.sha.value ?? "unresolved"} candidates=${event.sha.candidates ?? "unknown"}${event.sha.complete ? "" : " (collection incomplete)"}`
				: null,
	},
	{
		name: "pullRequests",
		value: (event) =>
			list(
				event.pullRequests.map(
					(pr) =>
						`repo=${pr.repositoryId}#${pr.number} ${pr.state}${pr.draft ? " draft" : ""}${pr.mergedAt ? ` merged=${pr.mergedAt} merge=${pr.mergeCommitSha}` : ""} head=${pr.headRef}@${pr.headSha}${pr.headRepositoryId !== pr.repositoryId ? ` headRepo=${pr.headRepositoryId}` : ""} [${pr.bases.join(",")}]${pr.commitInHead === null ? "" : ` commitInHead=${pr.commitInHead}`} ${pr.title}`,
				),
			),
	},
	{
		name: "ciRunCount",
		value: (event) =>
			event.ciRunCount === null
				? `unknown (${event.ciRunCountUnknown})`
				: `${event.ciRunCount} before ${event.ciRunCountThrough}`,
	},
	{ name: "ciRunsObserved", value: (event) => event.ciRunsObserved },
	{
		name: "ciConclusions",
		value: (event) =>
			Object.entries(event.ciConclusions)
				.map(([conclusion, count]) => `${conclusion}=${count}`)
				.join(" "),
	},
	{
		name: "ciRuns",
		free: true,
		value: (event) =>
			list(
				event.ciRuns.map(
					(run) =>
						`repo=${run.repositoryId} ${run.kind}#${run.runId}.${run.attempt} ${run.workflow} ${run.status}/${run.conclusion ?? "none"} ${run.event} ${run.branch}@${run.headSha} created=${run.createdAt}${run.startedAt && run.startedAt !== run.createdAt ? ` started=${run.startedAt}` : ""} completed=${run.completedAt ?? "unknown"} [${run.edges.map((edge) => `${edge.basis}${edge.linkBasis ? `:${edge.linkBasis}` : ""}${edge.prNumber ? `#${edge.prNumber}` : ""}`).join(",")}]`,
				),
			),
	},
	{
		name: "checksAfter",
		value: (event) =>
			event.checksAfter
				? `ran=${event.checksAfter.count} unconfirmed=${event.checksAfter.unconfirmed} sameCall=${event.checksAfter.sameCall}${event.checksAfter.first ? ` first@${event.checksAfter.first.record} ${event.checksAfter.first.at}` : ""}`
				: null,
	},
	{ name: "parentSessionId", value: (event) => event.parentSessionId },
];

type FailureExample = Extract<
	AnalysisFindOutput,
	{ source: "tool" }
>["groups"][number]["examples"][number];

function failureExamples(examples: readonly FailureExample[]): string[] {
	const byLine = new Map<string, string[]>();
	for (const example of examples) {
		const at = `${refText(example.ref)}@${example.record}${subagentOf(example.parentSessionId)}`;
		const refs = byLine.get(example.errorLine);
		if (refs) refs.push(at);
		else byLine.set(example.errorLine, [at]);
	}
	return [...byLine].map(([line, refs]) => `${refs.join(", ")} ${line}`);
}

function subagentOf(parentSessionId: string | null): string {
	return parentSessionId ? ` (subagent thread of ${parentSessionId})` : "";
}

export function renderFind(
	output: AnalysisFindOutput,
	verbosity: Verbosity = "full",
): string {
	const header = output.header;
	const parts = layout(output, verbosity);
	const shared = new SharedValues();
	const main = shared.share(parts.main);
	const after = parts.after.map((part) =>
		typeof part === "string"
			? part
			: table(part.headers, shared.share(part).rows),
	);
	const lines = [
		`${output.source === "sessions" ? `${output.of} groupBy=session` : output.source} ${header.from}..${header.to} sessions=${header.sessionsInScope} indexed=${header.indexedSessions} runs=${header.runsInScope}${header.matchedCalls === undefined ? "" : ` matchedCalls=${header.matchedCalls} groupCallTime=${header.groupCallTime ?? 0}`}`,
		`minutes=${header.minutes} activeMinutes=${header.activeMinutes} costUsd=${header.pricedCostUsd} unattributedCostUsd=${header.unattributedCostUsd} unpricedRuns=${header.unpricedRuns} rawChars=${header.rawChars} truncated=${header.truncated} hasMore=${header.cursor !== undefined}`,
		...(parts.omittedColumns.length
			? [
					`omitted: ${parts.omittedColumns.join(", ")} — call again with verbosity: "full" for them`,
				]
			: []),
		...header.notes.map((note) => `note: ${cell(truncateString(note))}`),
		...parts.head,
		...(header.trace ? [traceLine(header.trace)] : []),
		table(main.headers, main.rows),
		...(header.omitted ? [omittedMarker(header.omitted)] : []),
		...after,
		...shared.lines(),
		...(header.cursor ? [nextPageHint(main.rows.length, header.cursor)] : []),
	];
	return lines.join("\n");
}

export function summaryOmittedColumns(output: AnalysisFindOutput): string[] {
	return [...layout(output, "summary").omittedColumns];
}

export function findRowCosts(
	output: AnalysisFindOutput,
	verbosity: Verbosity = "full",
): number[] {
	const main = new SharedValues().share(layout(output, verbosity).main);
	return main.rows.map((row) => row.map(cell).join("\t").length);
}

export function nextPageHint(shown: number, cursor: string): string {
	return `Showing ${shown === 1 ? "1 result" : `${shown} results`}. More results exist: call find again with the same arguments and cursor=${cursor} to get the next page.`;
}

function linksLine(events: readonly GitEvent[]): string[] {
	const consulted = events.flatMap((event) =>
		event.edges ? [event.edges] : [],
	);
	if (consulted.length === 0) return [];
	const count = (statuses: readonly string[]) => {
		const counts = new Map<string, number>();
		for (const status of statuses)
			counts.set(status, (counts.get(status) ?? 0) + 1);
		return [...counts]
			.map(([status, n]) => `${n} ${status.replace("_", " ")}`)
			.join(", ");
	};
	const fromEdges = consulted.filter((edges) => edges.linkedBy === "edges");
	const atQuery = consulted.filter((edges) => edges.linkedBy === "query");
	const frozen = fromEdges.filter((edges) => edges.status === "frozen");
	return [
		`links: ${fromEdges.length} events from edges${frozen.length ? ` (${frozen.length} frozen)` : ""}, ${atQuery.length} linked at query time${atQuery.length ? ` (${count(atQuery.map((edges) => edges.status))})` : ""}`,
	];
}

function linksCell(edges: GitEvent["edges"]): string | null {
	if (!edges || (edges.linkedBy === "edges" && edges.status === "current"))
		return null;
	return `links=${edges.linkedBy}:${edges.status}${edges.builtAt ? ` builtAt=${edges.builtAt}` : ""}`;
}

function gitEventAddress(event: GitEvent): string {
	if (event.record === 0)
		return `${event.sessionId}/${event.agentId || "main"} ${event.call}`;
	const block = Math.floor(event.block / 65_536);
	const ordinal = event.block % 65_536;
	const at = `@${event.record}.${block}${ordinal ? ` match ${ordinal}` : ""}`;
	return event.turn === null
		? `${event.sessionId}/${event.agentId || "main"}${at} (no run)`
		: `${refText({ sessionId: event.sessionId, agentId: event.agentId, turn: event.turn })}${at}`;
}

export function traceLine(trace: AnalysisTrace): string {
	return `trace analysis=${trace.analysis} step=${trace.step} query=${trace.query}`;
}

export function table(
	headers: readonly string[],
	rows: readonly (readonly unknown[])[],
): string {
	return [
		headers.join("\t"),
		...rows.map((row) => row.map(cell).join("\t")),
	].join("\n");
}

export function refText(ref: RunRef): string {
	return JSON.stringify({
		sessionId: ref.sessionId,
		agentId: ref.agentId,
		turn: ref.turn,
	});
}
