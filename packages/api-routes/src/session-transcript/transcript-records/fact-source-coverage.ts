import legacySnapshot from "./codex-legacy-paths.json" with { type: "json" };
import { CODEX_RESIDUE_REVIEW } from "./codex-residue-review.js";
import sourceSnapshot from "./codex-source-0.162.0.json" with { type: "json" };
import {
	catalogSources,
	FACT_CATALOG,
	type FactEntry,
} from "./fact-catalog.js";
import { ignoreRuleFor, pathMatches } from "./fact-census.js";
import { CENSUS_IGNORED_PATHS } from "./fact-census-ignored.js";

export interface OraclePath {
	readonly path: string;
	readonly type: string;
	readonly source: string;
	readonly modes: string;
	readonly policy: number;
	readonly scope?: string;
}

export interface OracleSnapshot {
	readonly version: string;
	readonly paths: readonly OraclePath[];
}

export const CODEX_SOURCE_SNAPSHOT: OracleSnapshot = sourceSnapshot;

export const CODEX_LOCAL_SOURCE_NOTES = [
	{
		path: "response_item/function_call:exec_command.arguments.chars",
		reason:
			"Witnessed out-of-contract input component; not declared by the current exec_command writer schema.",
	},
	{
		path: "response_item/function_call:exec_command.arguments.session_id",
		reason:
			"Witnessed out-of-contract input component; not declared by the current exec_command writer schema.",
	},
	{
		path: "response_item/function_call:exec_command.arguments.{*}",
		reason:
			"Witnessed unknown argument keys, not a declaration of their meaning; parser 9 must allowlist options and exclude secrets.",
	},
	{
		path: "event_msg/exec_command_end.process_id",
		reason:
			"Witnessed legacy exec end-event component, outside the current durable writer snapshot.",
	},
	{
		path: "event_msg/exec_command_end.status",
		reason:
			"Witnessed legacy exec end-event component, outside the current durable writer snapshot.",
	},
	{
		path: "turn_context/.multi_agent_mode",
		reason:
			"Witnessed top-level context component; the current writer snapshot uses a different context representation.",
	},
	{
		path: "turn_context/.personality",
		reason:
			"Witnessed top-level context component; the current writer snapshot uses a different context representation.",
	},
	{
		path: "turn_context/.current_date",
		reason:
			"Witnessed top-level context component; the current writer snapshot uses a different context representation.",
	},
	{
		path: "turn_context/.timezone",
		reason:
			"Witnessed top-level context component; the current writer snapshot uses a different context representation.",
	},
	{
		path: "turn_context/.workspace_roots[]",
		reason:
			"Witnessed top-level context component; the current writer snapshot uses a different context representation.",
	},
	{
		path: "turn_context/.truncation_policy.limit",
		reason:
			"Witnessed historical context truncation component, not a currently declared writer field.",
	},
	{
		path: "turn_context/.truncation_policy.mode",
		reason:
			"Witnessed historical context truncation component, not a currently declared writer field.",
	},
] as const;

export function sourceCensusCoverage(
	paths: Readonly<Record<string, number>>,
	snapshot: OracleSnapshot = CODEX_SOURCE_SNAPSHOT,
) {
	const counts = {
		declared: 0,
		opaque: 0,
		tool_defined: 0,
		legacy: 0,
		unknown: 0,
	};
	const unknown: string[] = [];
	for (const path of Object.keys(paths)) {
		const match = sourcePathMatch(path, snapshot);
		if (match !== undefined) counts[match.kind]++;
		else if (legacySnapshot.paths.some((legacy) => legacy.path === path))
			counts.legacy++;
		else if (
			/^response_item\/function_call:[^.]+\.arguments[.[]/u.test(path) &&
			sourcePathMatch(
				`${literalPath(path).split(".arguments")[0]}.arguments`,
				snapshot,
			) !== undefined
		)
			counts.tool_defined++;
		else {
			counts.unknown++;
			unknown.push(path);
		}
	}
	return { total: Object.keys(paths).length, ...counts, unknownPaths: unknown };
}

export function sourceSnapshotDiff(
	previous: OracleSnapshot,
	next: OracleSnapshot,
	entries: readonly FactEntry[] = FACT_CATALOG,
) {
	const before = new Set(previous.paths.map((entry) => entry.path));
	const after = new Set(next.paths.map((entry) => entry.path));
	const added = [...after].filter((path) => !before.has(path)).sort();
	const removed = [...before].filter((path) => !after.has(path)).sort();
	const removedStoredDependencies = entries.flatMap((entry) => {
		const fact = entry.agents.codex;
		if (fact.status !== "stored" && fact.status !== "wrong") return [];
		return fact.sources.flatMap((pattern) =>
			(sourcePathMatch(pattern, previous)?.paths ?? [])
				.filter((path) => removed.includes(path.path))
				.map((path) => ({
					key: `${entry.view}/${entry.id}`,
					source: pattern,
					removed: path.path,
				})),
		);
	});
	return { added, removed, removedStoredDependencies };
}

function literalPath(path: string): string {
	return path.split("~")[0] ?? path;
}

export function sourcePathMatch(
	pattern: string,
	snapshot: OracleSnapshot = CODEX_SOURCE_SNAPSHOT,
): { kind: "declared" | "opaque"; paths: readonly OraclePath[] } | undefined {
	const base = literalPath(pattern);
	const declared = snapshot.paths.filter(
		(entry) => pathMatches(base, entry.path) || pathMatches(entry.path, base),
	);
	if (declared.length > 0) return { kind: "declared", paths: declared };
	const opaque = snapshot.paths.filter(
		(entry) =>
			entry.scope === "opaque" &&
			pathMatches(entry.path.replace(/\[\]$/u, ""), base, true),
	);
	if (opaque.length > 0) return { kind: "opaque", paths: opaque };
	return undefined;
}

export function sourceOracleCoverage(
	entries: readonly FactEntry[] = FACT_CATALOG,
	snapshot: OracleSnapshot = CODEX_SOURCE_SNAPSHOT,
) {
	const sources = entries.flatMap((entry) => {
		const fact = entry.agents.codex;
		return fact.sourceMappings
			.filter((source) => source.role === "primary")
			.map(({ path }) => ({ key: `${entry.view}/${entry.id}`, path, fact }));
	});
	const declared = sources.filter(
		(source) => sourcePathMatch(source.path, snapshot)?.kind === "declared",
	);
	const opaque = sources.filter(
		(source) => sourcePathMatch(source.path, snapshot)?.kind === "opaque",
	);
	const missing = sources.filter(
		(source) => sourcePathMatch(source.path, snapshot) === undefined,
	);
	const legacy = missing.filter((source) =>
		source.fact.legacySources?.includes(source.path),
	);
	const unresolved = missing.filter(
		(source) =>
			!source.fact.legacySources?.includes(source.path) &&
			!CODEX_LOCAL_SOURCE_NOTES.some((note) => note.path === source.path),
	);
	const catalog =
		entries === FACT_CATALOG
			? catalogSources("codex")
			: sources.map((source) => source.path);
	const context = entries.flatMap((entry) =>
		entry.agents.codex.sourceMappings
			.filter((source) => source.role === "context")
			.map((source) => literalPath(source.path)),
	);
	const paths = snapshot.paths.map((entry) => {
		const mapped = catalog.some(
			(source) =>
				pathMatches(literalPath(source), entry.path) ||
				pathMatches(entry.path, literalPath(source)),
		);
		const ignored = mapped
			? undefined
			: ignoreRuleFor(entry.path, "codex", CENSUS_IGNORED_PATHS);
		return {
			...entry,
			status: mapped
				? "mapped"
				: ignored !== undefined
					? "ignored"
					: CODEX_RESIDUE_REVIEW.pending.some(
								(review) => review.path === entry.path,
							)
						? "pending_review"
						: context.some(
									(pattern) =>
										pathMatches(pattern, entry.path) ||
										pathMatches(entry.path, pattern),
								)
							? "context"
							: "residue",
			...(ignored === undefined ? {} : { reason: ignored.reason }),
		};
	});
	return {
		version: snapshot.version,
		total: paths.length,
		declaredSources: declared.length,
		opaqueSources: opaque.length,
		legacySources: legacy.length,
		localSourceNotes: missing.flatMap((source) =>
			CODEX_LOCAL_SOURCE_NOTES.filter((note) => note.path === source.path),
		),
		missingSources: unresolved.map((source) => ({
			key: source.key,
			path: source.path,
			stored: source.fact.status === "stored" || source.fact.status === "wrong",
		})),
		mapped: paths.filter((path) => path.status === "mapped").length,
		ignored: paths.filter((path) => path.status === "ignored").length,
		context: paths.filter((path) => path.status === "context"),
		pending: paths.filter((path) => path.status === "pending_review"),
		pendingReview: CODEX_RESIDUE_REVIEW.pending.map((review) => ({
			...review,
			coverage:
				paths.find((path) => path.path === review.path)?.status ??
				"outside_snapshot",
		})),
		residue: paths.filter((path) => path.status === "residue"),
	};
}
