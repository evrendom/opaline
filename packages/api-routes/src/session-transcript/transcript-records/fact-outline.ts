import {
	FACT_AGENTS,
	FACT_CATALOG,
	type FactAgent,
	type FactEntry,
	type FactStatus,
} from "./fact-catalog.js";
import {
	type Census,
	type CensusPathStats,
	censusPathParts,
	censusPathReport,
	compareVersions,
	type IgnoredPath,
	ignoreRuleFor,
	pathMatches,
} from "./fact-census.js";
import { AGENT_NAMES } from "./fact-matrix.js";

/**
 * The structural half of the fact review page: for each agent, every path
 * the census found (its counts, value types, versions, and what it is to the
 * catalog: a fact's source, ignored, or unmapped) as a JSON-shaped outline,
 * plus the catalog sources the corpus never showed; and for each catalog fact,
 * which paths of each agent it connects. Values are only the census's short
 * enum-like ones.
 */

/** What a path is to the catalog. */
export type OutlineStatus =
	/** The agent's status for the fact(s) it is a source of. */
	| FactStatus
	/** A source Opaline does not read yet (a stored fact's gap). */
	| "gap"
	| "ignored"
	| "unmapped"
	/** A catalog source no path of this corpus matches. */
	| "unseen";

export interface OutlinePathFact {
	/** The fact's review key (`view/id`). */
	readonly key: string;
	/** The agent's status for the fact; `gap` when this source is not read yet. */
	readonly status: FactStatus | "gap";
}

export interface OutlinePath {
	/** The census path, or for `unseen` the catalog source pattern. */
	readonly path: string;
	readonly status: OutlineStatus;
	/** Records that carry it (0 when unseen). */
	readonly count: number;
	/** JSON types of its values, most common first. */
	readonly types: readonly string[];
	/** Oldest and newest agent version that wrote it (empty when unseen). */
	readonly versions: readonly string[];
	readonly versionCount: number;
	/** Longest string value, in characters. */
	readonly maxChars: number;
	/** Enum-like values the census keeps, most common first, with counts. */
	readonly values: readonly (readonly [string, number])[];
	/** Facts it is a source of. */
	readonly facts: readonly OutlinePathFact[];
	/** For `ignored`: index into the agent's `rules`. */
	readonly rule?: number;
}

/** One line of the outline. */
export interface OutlineNode {
	/**
	 * `variant`: a record kind level (`"type": "user"`, `"payload.type": …`);
	 * `key`: an object key; `outer`: a Codex record field outside the payload;
	 * `element`: an array element; `block`: a typed array element
	 * (`{"type": "tool_use", "name": "Bash"}`); `convention`: a text
	 * convention of its string.
	 */
	readonly kind:
		| "variant"
		| "key"
		| "outer"
		| "element"
		| "block"
		| "convention";
	/** Variant key, object key, block type or convention id. */
	readonly label: string;
	/** Variant value or block tool name. */
	readonly value?: string;
	/** Index into the agent's `paths` of the path ending here. */
	readonly path?: number;
	/** For variants: records of this kind. */
	readonly records?: number;
	readonly children?: readonly OutlineNode[];
}

export interface OutlineAgent {
	readonly agent: FactAgent;
	readonly name: string;
	readonly files: number;
	readonly records: number;
	readonly unparseable: number;
	/** Oldest and newest agent version in the corpus. */
	readonly versions: readonly string[];
	readonly paths: readonly OutlinePath[];
	/** Ignore rules that cover at least one path. */
	readonly rules: readonly { readonly path: string; readonly reason: string }[];
	readonly tree: readonly OutlineNode[];
}

/** Which agents record a fact. */
export type SideConnection = "both" | "neither" | FactAgent;

export interface SideSource {
	/** The catalog source pattern. */
	readonly pattern: string;
	/** A stored fact's source Opaline does not read yet. */
	readonly gap: boolean;
	/** Indexes into the agent's outline `paths` it matches (an `unseen` entry when none). */
	readonly paths: readonly number[];
}

export interface SideFact {
	readonly key: string;
	readonly connection: SideConnection;
	readonly agents: Readonly<Record<FactAgent, readonly SideSource[]>>;
}

export interface FactCorpus {
	/** Where the census was taken, as the page names it. */
	readonly label: string;
	readonly census: Census;
}

export interface FactCorpusData {
	readonly label: string;
	readonly agents: readonly OutlineAgent[];
	readonly side: readonly SideFact[];
}

/** The key that identifies a fact on the page (ids repeat across views). */
export function factReviewKey(entry: FactEntry): string {
	return `${entry.view}/${entry.id}`;
}

interface CatalogSource {
	readonly key: string;
	readonly pattern: string;
	readonly gap: boolean;
	readonly status: FactStatus;
}

function catalogSourcesOf(agent: FactAgent): CatalogSource[] {
	return FACT_CATALOG.flatMap((entry) => {
		const fact = entry.agents[agent];
		const key = factReviewKey(entry);
		const gap = fact.status === "stored" ? (fact.gap?.sources ?? []) : [];
		return [
			...fact.sources.map((pattern) => ({
				key,
				pattern,
				gap: false,
				status: fact.status,
			})),
			...gap.map((pattern) => ({
				key,
				pattern,
				gap: true,
				status: fact.status,
			})),
		];
	});
}

const STATUS_PRIORITY: readonly (FactStatus | "gap")[] = [
	"wrong",
	"pending",
	"gap",
	"stored",
	"not_recorded",
];

function pathFacts(sources: readonly CatalogSource[]): OutlinePathFact[] {
	const byKey = new Map<string, FactStatus | "gap">();
	for (const source of sources) {
		const status = source.gap ? "gap" : source.status;
		const previous = byKey.get(source.key);
		// A fact read from one of its sources here is read, whatever its gaps.
		if (previous === undefined || previous === "gap")
			byKey.set(source.key, status);
	}
	return [...byKey].map(([key, status]) => ({ key, status }));
}

function primaryStatus(facts: readonly OutlinePathFact[]): FactStatus | "gap" {
	return (
		STATUS_PRIORITY.find((status) =>
			facts.some((fact) => fact.status === status),
		) ?? "stored"
	);
}

/** The variant levels a record kind names, outermost first. */
function headLevels(
	head: string,
	agent: FactAgent,
): { label: string; value: string }[] {
	const slash = head.indexOf("/");
	if (slash === -1) return [{ label: "type", value: head }];
	const type = head.slice(0, slash);
	const rest = head.slice(slash + 1);
	if (agent === "claude_code")
		return [
			{ label: "type", value: type },
			{
				label: type === "attachment" ? "attachment.type" : "subtype",
				value: rest,
			},
		];
	const colon = rest.indexOf(":");
	const payloadType = colon === -1 ? rest : rest.slice(0, colon);
	const levels = [
		{ label: "type", value: type },
		{ label: "payload.type", value: payloadType },
	];
	if (colon !== -1)
		levels.push({
			label:
				payloadType === "item_completed"
					? "item.type"
					: payloadType === "message"
						? "role"
						: "name",
			value: rest.slice(colon + 1),
		});
	return levels;
}

interface BuildNode {
	kind: OutlineNode["kind"];
	label: string;
	value?: string;
	path?: number;
	records?: number;
	readonly children: Map<string, BuildNode>;
}

function childNode(
	parent: BuildNode,
	id: string,
	make: () => Omit<BuildNode, "children">,
): BuildNode {
	let node = parent.children.get(id);
	if (node === undefined) {
		node = { ...make(), children: new Map() };
		parent.children.set(id, node);
	}
	return node;
}

function variantNodes(
	root: BuildNode,
	head: string,
	agent: FactAgent,
): BuildNode[] {
	const nodes: BuildNode[] = [];
	let node = root;
	for (const level of headLevels(head, agent)) {
		node = childNode(node, `v:${level.label}=${level.value}`, () => ({
			kind: "variant",
			label: level.label,
			value: level.value,
		}));
		nodes.push(node);
	}
	return nodes;
}

function insertPath(
	root: BuildNode,
	agent: FactAgent,
	path: string,
	index: number,
): void {
	const { head, steps } = censusPathParts(path);
	let node = variantNodes(root, head, agent).at(-1) ?? root;
	for (const step of steps) {
		switch (step.kind) {
			case "key":
			case "outer":
				node = childNode(node, `${step.kind}:${step.name}`, () => ({
					kind: step.kind,
					label: step.name,
				}));
				break;
			case "element":
				node = childNode(node, "element", () => ({
					kind: "element",
					label: "[]",
				}));
				break;
			case "block":
				node = childNode(node, `block:${step.type}:${step.name ?? ""}`, () => ({
					kind: "block",
					label: step.type,
					...(step.name === undefined ? {} : { value: step.name }),
				}));
				break;
			case "convention":
				node = childNode(node, `convention:${step.id}`, () => ({
					kind: "convention",
					label: step.id,
				}));
				break;
		}
	}
	if (node.path !== undefined)
		throw new Error(`fact outline: two paths end at ${path}`);
	node.path = index;
}

function finishNode(node: BuildNode): OutlineNode {
	const children = [...node.children.values()];
	// Fields in the order the corpus first showed them; record kinds by size.
	const fields = children.filter((child) => child.kind !== "variant");
	const variants = children
		.filter((child) => child.kind === "variant")
		.sort((a, b) => (b.records ?? 0) - (a.records ?? 0));
	const ordered = [...fields, ...variants].map(finishNode);
	return {
		kind: node.kind,
		label: node.label,
		...(node.value === undefined ? {} : { value: node.value }),
		...(node.path === undefined ? {} : { path: node.path }),
		...(node.records === undefined ? {} : { records: node.records }),
		...(ordered.length === 0 ? {} : { children: ordered }),
	};
}

function versionRange(versions: Iterable<string>): string[] {
	const sorted = [...new Set(versions)]
		.filter((version) => version !== "?")
		.sort(compareVersions);
	const first = sorted[0];
	const last = sorted.at(-1);
	return first === undefined || last === undefined ? [] : [first, last];
}

function outlineAgent(
	census: Census,
	agent: FactAgent,
	ignored: readonly IgnoredPath[],
): { outline: OutlineAgent; sources: Map<CatalogSource, number[]> } {
	const stats = census.paths.get(agent) ?? new Map<string, CensusPathStats>();
	const sources = catalogSourcesOf(agent);
	const matched = new Map<CatalogSource, number[]>(
		sources.map((source) => [source, []]),
	);
	const rules: IgnoredPath[] = [];
	const paths: OutlinePath[] = [];
	const allVersions = new Set<string>();
	for (const [path, pathStats] of stats) {
		const index = paths.length;
		const report = censusPathReport(path, pathStats);
		for (const version of pathStats.versions.keys()) allVersions.add(version);
		const matching = sources.filter((source) =>
			pathMatches(source.pattern, path),
		);
		for (const source of matching) matched.get(source)?.push(index);
		const facts = pathFacts(matching);
		let status: OutlineStatus = "unmapped";
		let rule: number | undefined;
		if (facts.length > 0) status = primaryStatus(facts);
		else {
			const ignoreRule = ignoreRuleFor(path, agent, ignored);
			if (ignoreRule !== undefined) {
				status = "ignored";
				rule = rules.indexOf(ignoreRule);
				if (rule === -1) rule = rules.push(ignoreRule) - 1;
			}
		}
		paths.push({
			path,
			status,
			count: report.count,
			types: report.types,
			versions: versionRange(pathStats.versions.keys()),
			versionCount: [...pathStats.versions.keys()].filter((v) => v !== "?")
				.length,
			maxChars: report.maxChars,
			values: report.values,
			facts,
			...(rule === undefined ? {} : { rule }),
		});
	}
	// Catalog sources the corpus never showed: one entry per pattern.
	const unseen = new Map<string, CatalogSource[]>();
	for (const source of sources)
		if (matched.get(source)?.length === 0)
			unseen.set(source.pattern, [
				...(unseen.get(source.pattern) ?? []),
				source,
			]);
	for (const [pattern, patternSources] of unseen) {
		const index = paths.length;
		for (const source of patternSources) matched.get(source)?.push(index);
		paths.push({
			path: pattern,
			status: "unseen",
			count: 0,
			types: [],
			versions: [],
			versionCount: 0,
			maxChars: 0,
			values: [],
			facts: pathFacts(patternSources),
		});
	}

	const root: BuildNode = { kind: "variant", label: "", children: new Map() };
	for (const [kind, records] of census.kinds.get(agent) ?? [])
		for (const node of variantNodes(root, kind, agent))
			node.records = (node.records ?? 0) + records;
	paths.forEach((entry, index) => {
		insertPath(root, agent, entry.path, index);
	});

	return {
		outline: {
			agent,
			name: AGENT_NAMES[agent],
			files: census.files.get(agent) ?? 0,
			records: census.records.get(agent) ?? 0,
			unparseable: census.unparseable.get(agent) ?? 0,
			versions: versionRange(allVersions),
			paths,
			rules: rules.map((rule) => ({ path: rule.path, reason: rule.reason })),
			tree: finishNode(root).children ?? [],
		},
		sources: matched,
	};
}

/** Which agents record a fact: every status but `not_recorded` counts. */
export function sideConnection(entry: FactEntry): SideConnection {
	const claude = entry.agents.claude_code.status !== "not_recorded";
	const codex = entry.agents.codex.status !== "not_recorded";
	if (claude && codex) return "both";
	if (claude) return "claude_code";
	return codex ? "codex" : "neither";
}

/** The outline of each agent and the side-by-side rows, from a census. */
export function factCorpusData(
	corpus: FactCorpus,
	ignored: readonly IgnoredPath[],
): FactCorpusData {
	const built = FACT_AGENTS.map((agent) =>
		outlineAgent(corpus.census, agent, ignored),
	);
	const side = FACT_CATALOG.map((entry): SideFact => {
		const key = factReviewKey(entry);
		const agents = Object.fromEntries(
			FACT_AGENTS.map((agent, index) => {
				const matched = built[index]?.sources ?? new Map();
				const sources = [...matched]
					.filter(([source]) => source.key === key)
					.map(([source, paths]) => ({
						pattern: source.pattern,
						gap: source.gap,
						paths,
					}));
				return [agent, sources];
			}),
		) as Record<FactAgent, SideSource[]>;
		return { key, connection: sideConnection(entry), agents };
	});
	return {
		label: corpus.label,
		agents: built.map((agent) => agent.outline),
		side,
	};
}
