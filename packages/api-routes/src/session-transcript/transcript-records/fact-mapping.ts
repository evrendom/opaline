import legacySnapshot from "./codex-legacy-paths.json" with { type: "json" };
import type { AgentFact, FactAgent, FactEntry } from "./fact-catalog.js";
import { type Census, pathMatches } from "./fact-census.js";
import censusSnapshot from "./fact-mapping-census.json" with { type: "json" };
import type {
	FactMapping,
	MappingEvidence,
	MappingRelation,
} from "./fact-mapping-types.js";
import {
	CODEX_SOURCE_SNAPSHOT,
	sourcePathMatch,
} from "./fact-source-coverage.js";

export type {
	FactMapping,
	MappingEvidence,
	MappingRelation,
} from "./fact-mapping-types.js";

export type MappingConfidence =
	| "verified"
	| "observed"
	| "asserted"
	| "not_applicable";
export type FactComparability =
	| "unreviewed"
	| "direct"
	| "transformed"
	| "caveat"
	| "conflict"
	| "one_sided"
	| "absent"
	| "application";

export const COMPARABILITY_LABELS: Readonly<Record<FactComparability, string>> =
	{
		unreviewed: "Not yet judged",
		direct: "Directly comparable",
		transformed: "Comparable after transform",
		caveat: "Comparable with caveat",
		conflict: "Semantic conflict",
		one_sided: "One-sided mapping",
		absent: "No observed counterpart",
		application: "Opaline-derived/provenance; N/A per agent",
	};

export function mappingConfidence(mapping: FactMapping): MappingConfidence {
	if (
		mapping.relation.kind === "derived" ||
		mapping.relation.kind === "provenance"
	)
		return "not_applicable";
	const primary = mapping.sourceMappings?.filter(
		(source) => source.role === "primary",
	);
	const evidence = mapping.evidence.filter(
		(item) =>
			!("path" in item) ||
			primary === undefined ||
			primary.some((source) =>
				pathMatches(source.path.split("~")[0] ?? source.path, item.path),
			),
	);
	const witnessed = evidence.some(
		(item) =>
			item.kind === "fixture_test" ||
			(item.kind === "census" && "count" in item && item.count > 0),
	);
	const semantic = evidence.some(
		(item) =>
			item.kind === "paired_run" ||
			((item.kind === "writer_source" || item.kind === "published_types") &&
				item.supportsMeaning),
	);
	const supportedPaths =
		primary === undefined ||
		primary.every(
			(source) =>
				source.relation.kind !== "unreviewed" &&
				mapping.evidence.some(
					(item) =>
						item.kind === "paired_run" ||
						((item.kind === "writer_source" ||
							item.kind === "published_types") &&
							item.supportsMeaning &&
							pathMatches(source.path.split("~")[0] ?? source.path, item.path)),
				),
		);
	if (
		witnessed &&
		semantic &&
		supportedPaths &&
		mapping.relation.kind !== "unreviewed"
	)
		return "verified";
	return witnessed ? "observed" : "asserted";
}

export function factComparability(entry: FactEntry): FactComparability {
	const left = entry.agents.claude_code;
	const right = entry.agents.codex;
	if (left.conflict !== undefined || right.conflict !== undefined)
		return "conflict";
	if (
		[left, right].some(
			(mapping) =>
				mapping.relation.kind === "derived" ||
				mapping.relation.kind === "provenance",
		)
	)
		return "application";
	const absent = (mapping: FactMapping) =>
		mapping.relation.kind === "not_found" ||
		mapping.relation.kind === "not_emitted";
	if (absent(left) && absent(right)) return "absent";
	if (absent(left) || absent(right)) return "one_sided";
	if (
		left.relation.kind === "unreviewed" ||
		right.relation.kind === "unreviewed"
	)
		return "unreviewed";
	if (left.relation.kind === "exact" && right.relation.kind === "exact")
		return "direct";
	if (
		[left, right].every(
			(mapping) =>
				mapping.relation.kind === "exact" ||
				mapping.relation.kind === "transform",
		)
	)
		return "transformed";
	return "caveat";
}

export function relationLabel(relation: MappingRelation): string {
	if (relation.kind === "derived")
		return `derived from ${relation.from.join(", ")}`;
	if (relation.kind === "provenance")
		return "provenance: Opaline bookkeeping (N/A per agent)";
	return relation.kind === "transform"
		? `transform: ${relation.transform}`
		: relation.kind;
}

export interface MappingCorpus {
	readonly corpus: string;
	readonly paths: Readonly<Record<FactAgent, Readonly<Record<string, number>>>>;
}

export function mappingCorpus(census: Census, label: string): MappingCorpus {
	return {
		corpus: label,
		paths: {
			claude_code: Object.fromEntries(
				[...(census.paths.get("claude_code") ?? [])].map(([path, stats]) => [
					path,
					stats.count,
				]),
			),
			codex: Object.fromEntries(
				[...(census.paths.get("codex") ?? [])].map(([path, stats]) => [
					path,
					stats.count,
				]),
			),
		},
	};
}

export function withMappingEvidence(
	entries: readonly FactEntry[],
	corpus: MappingCorpus = censusSnapshot,
): FactEntry[] {
	return entries.map((entry) => ({
		...entry,
		agents: {
			claude_code: mappingWithEvidence(
				entry.agents.claude_code,
				"claude_code",
				corpus,
			),
			codex: mappingWithEvidence(entry.agents.codex, "codex", corpus),
		},
	}));
}

function mappingWithEvidence(
	fact: AgentFact,
	agent: FactAgent,
	corpus: MappingCorpus,
): AgentFact {
	const evidence: MappingEvidence[] = [
		...fact.evidence,
		{
			kind: "llm_audit",
			reference:
				"fact-catalog seed and uniqueness verifier (git b5a6dbdf, 6ab5b010)",
			explanation: "Catalog assertion, not an independent semantic oracle.",
		},
	];
	if (fact.status === "not_recorded")
		evidence.push({
			kind: "census",
			search: fact.searched,
			corpus: corpus.corpus,
		});
	const patterns = fact.sourceMappings
		.filter((source) => source.role === "primary")
		.map((source) => source.path);
	if (agent === "codex") {
		for (const pattern of patterns) {
			const match = sourcePathMatch(pattern);
			const source = match?.paths[0];
			if (source === undefined) continue;
			const reference = /^(.+):(\d+)$/u.exec(source.source);
			if (reference?.[1] === undefined || reference[2] === undefined)
				throw new Error(`Invalid writer reference ${source.source}`);
			if (
				fact.evidence.some(
					(item) =>
						item.kind === "writer_source" &&
						item.path === source.path &&
						item.file === reference[1] &&
						item.line === Number(reference[2]),
				)
			)
				continue;
			evidence.push({
				kind: "writer_source",
				path: source.path,
				file: reference[1],
				line: Number(reference[2]),
				version: CODEX_SOURCE_SNAPSHOT.version,
				supportsMeaning: false,
				explanation:
					match?.kind === "opaque"
						? `Open JSON parent for ${pattern}; neither this child nor its meaning is declared. Not semantic proof.`
						: `Representative declaration for ${pattern} (${source.modes} history); existence does not establish the relation or text convention. Semantic review is still required.`,
			});
		}
		for (const legacy of legacySnapshot.paths) {
			if (
				corpus.paths.codex[legacy.path] === undefined &&
				(fact.legacySources ?? []).some((pattern) =>
					pathMatches(pattern, legacy.path),
				)
			)
				evidence.push({
					kind: "census",
					path: legacy.path,
					count: legacy.count,
					corpus: legacySnapshot.corpus,
					versions: legacy.versions,
				});
		}
	}
	for (const [path, count] of Object.entries(corpus.paths[agent])) {
		if (patterns.some((pattern) => pathMatches(pattern, path))) {
			const legacy =
				agent === "codex" &&
				fact.legacySources?.some((pattern) => pathMatches(pattern, path))
					? legacySnapshot.paths.find((entry) => entry.path === path)
					: undefined;
			evidence.push({
				kind: "census",
				path,
				count,
				corpus: corpus.corpus,
				...(legacy === undefined ? {} : { versions: legacy.versions }),
			});
		}
	}
	if (fact.status === "stored" || fact.status === "wrong") {
		const hasColumns =
			(fact.stores.facts?.length ?? 0) + (fact.stores.record?.length ?? 0) > 0;
		if (hasColumns || fact.testedIn !== undefined)
			evidence.push({
				kind: "fixture_test",
				file:
					fact.testedIn ??
					"packages/api-routes/src/session-transcript/transcript-records/l1-facts.test.ts",
				test: hasColumns
					? "every stored fact has a fixture case for its agent (parser behaviour, not semantic equivalence)"
					: "catalog testedIn reference (not a planted-value paired run)",
			});
	}
	return { ...fact, evidence };
}

export function mappingMetrics(
	entries: readonly FactEntry[],
	agent: FactAgent,
) {
	const confidence = {
		verified: 0,
		observed: 0,
		asserted: 0,
		not_applicable: 0,
	};
	const relations = {
		unreviewed: 0,
		exact: 0,
		transform: 0,
		close: 0,
		broader: 0,
		narrower: 0,
		not_emitted: 0,
		not_found: 0,
		derived: 0,
		provenance: 0,
	};
	const pathRelations = { ...relations };
	let contextPaths = 0;
	let conflicts = 0;
	for (const entry of entries) {
		const fact = entry.agents[agent];
		confidence[mappingConfidence(fact)]++;
		relations[fact.relation.kind]++;
		for (const source of fact.sourceMappings) {
			if (source.role === "context") contextPaths++;
			else pathRelations[source.relation.kind]++;
		}
		if (factComparability(entry) === "conflict") conflicts++;
	}
	return {
		total: entries.length,
		literal: entries.length - confidence.not_applicable,
		confidence,
		relations,
		pathRelations,
		contextPaths,
		conflicts,
		judged:
			relations.exact +
			relations.transform +
			relations.close +
			relations.broader +
			relations.narrower,
	};
}

export function evidenceLabel(item: MappingEvidence): string {
	switch (item.kind) {
		case "writer_source":
			return `${item.kind}: ${item.file}:${item.line} @ ${item.version} — ${item.explanation}`;
		case "published_types":
			return `${item.kind}: ${item.reference} @ ${item.version} — ${item.explanation}`;
		case "census":
			return "path" in item
				? `${item.kind}: ${item.path} seen ${item.count} times in ${item.corpus}${item.versions === undefined ? "" : `; legacy observed versions: ${item.versions.join(", ")}`}`
				: `${item.kind}: ${item.search} (${item.corpus})`;
		case "fixture_test":
			return `${item.kind}: ${item.file} — ${item.test}`;
		case "paired_run":
			return `${item.kind}: ${item.reference} — ${item.scenario}`;
		case "llm_audit":
			return `${item.kind}: ${item.reference} — ${item.explanation}`;
	}
}
