import type { MeasureScope } from "@rudel/api-routes";
import { shardWindows } from "../../services/analysis/patterns-sql.js";
import {
	buildDigest,
	type Digest,
	joinDigestRuns,
	type Row,
	renderDigest,
} from "../../services/analysis/retro-digest.js";
import {
	contextSizesStatement,
	digestCallsSql,
	digestEditsSql,
	digestRunsSql,
	digestSessionsSql,
	digestSeveritySql,
	digestUsageSql,
	SEVERITY_SHARD_DAYS,
	startDirsStatement,
	type TrustedStatement,
} from "../../services/analysis/retro-digest-sql.js";
import {
	cohortSelect,
	measureParams,
} from "../../services/analysis/retro-measures.js";
import { badRequest } from "./measure-statement.js";
import { patternStatement } from "./pattern-statement.js";

export interface DigestReader {
	readonly workspaceId: string;
	view(query: string, cohort: string): Promise<Row[]>;
	trusted(statement: TrustedStatement): Promise<Row[]>;
}

export interface DigestResult {
	readonly digest: Digest;
	readonly text: string;
	readonly ms: number;
	readonly from: string;
	readonly to: string;
}

const first = (rows: readonly Row[]): Row => rows[0] ?? {};

async function merged(
	reader: DigestReader,
	parts: readonly string[],
	cohort: string,
): Promise<Row> {
	const row: Row = {};
	for (const part of parts)
		Object.assign(row, first(await reader.view(part, cohort)));
	return row;
}

export async function runDigest(
	reader: DigestReader,
	input: MeasureScope,
	today: Date,
): Promise<DigestResult> {
	const started = performance.now();
	const params = measureParams({ ...input, limit: 20 }, today);
	if ("error" in params) throw badRequest(params.error);
	const cohort = cohortSelect(params);
	const sessions = await merged(reader, digestSessionsSql(params), cohort);
	const listed = Array.isArray(sessions.sessions)
		? (sessions.sessions as unknown[][])
		: [];
	const scope = {
		workspaceId: reader.workspaceId,
		sessions: listed.map((t) => String(t[0])),
		users: listed.map((t) => String(t[14])),
	};
	const empty = scope.sessions.length === 0;
	const startDirs = empty
		? []
		: await reader.trusted(startDirsStatement(scope));
	const calls = empty
		? {}
		: await merged(reader, digestCallsSql(params), cohort);
	const edits = empty
		? {}
		: first(await reader.view(digestEditsSql(params), cohort));
	const usage = empty
		? {}
		: await merged(reader, digestUsageSql(params), cohort);
	const contextSizes = empty
		? []
		: await reader.trusted(contextSizesStatement(scope));
	const runs = empty
		? {}
		: joinDigestRuns(await merged(reader, digestRunsSql(params), cohort));
	const severity: Row[] = [];
	if (!empty)
		for (const shard of shardWindows(params, SEVERITY_SHARD_DAYS))
			for (const part of digestSeveritySql(shard))
				severity.push(...(await reader.view(part, cohortSelect(shard))));
	const patterns: Row[] = [];
	if (!empty) {
		const statement = patternStatement(
			{ action: "list", ...input, minCount: 2, limit: 100 },
			today,
			{ withRuns: true },
		);
		const rows: Row[] = [];
		for (const part of statement.parts.queries)
			rows.push(...(await reader.view(part.query, part.cohort ?? cohort)));
		const cited = new Map<string, Set<string>>();
		for (const row of rows) {
			const id = String(row.id);
			const known = cited.get(id) ?? new Set<string>();
			for (const rid of Array.isArray(row.rids) ? row.rids : [])
				known.add(String(rid));
			cited.set(id, known);
		}
		patterns.push(
			...statement.parts.merge(rows).map((row) => ({
				...row,
				rids: [...(cited.get(String(row.id)) ?? [])],
			})),
		);
	}
	const digest = buildDigest(
		{
			sessions,
			calls,
			edits,
			usage,
			startDirs,
			contextSizes,
			runs,
			severity,
			patterns,
		},
		{
			repository: params.repository ?? null,
			from: params.from,
			to: params.to,
			latest: params.latest ?? null,
			listed: params.sessions?.length ?? null,
		},
	);
	const ms = Math.round(performance.now() - started);
	return {
		digest,
		text: renderDigest(digest, ms),
		ms,
		from: params.from,
		to: params.to,
	};
}
