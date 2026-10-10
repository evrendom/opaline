import {
	type AgentFact,
	FACT_AGENTS,
	FACT_CATALOG,
	FACT_VIEWS,
	type FactAgent,
	type FactEntry,
	type FactStatus,
	type FactView,
	LOCAL_CENSUS,
} from "./fact-catalog.js";
import {
	COMPARABILITY_LABELS,
	factComparability,
	mappingConfidence,
	mappingMetrics,
	relationLabel,
	withMappingEvidence,
} from "./fact-mapping.js";
import censusSnapshot from "./fact-mapping-census.json" with { type: "json" };
import {
	sourceCensusCoverage,
	sourceOracleCoverage,
} from "./fact-source-coverage.js";

const MAPPING_CATALOG = withMappingEvidence(FACT_CATALOG);

/**
 * The Claude Code vs Codex fact matrix (docs/l1-fact-matrix.md), generated
 * from the fact catalog: one table per view, one row per fact, a cell per
 * agent with its status and where it comes from, details for every plan,
 * gap and search, and the questions only the product owner can answer.
 */

export const FACT_MATRIX_PATH = "docs/l1-fact-matrix.md";

export const AGENT_NAMES: Readonly<Record<FactAgent, string>> = {
	claude_code: "Claude Code",
	codex: "Codex",
};

export const VIEW_TITLES: Readonly<Record<FactView, string>> = {
	calls: "Calls: one row per tool call",
	runs: "Runs: one row per run (a prompt and everything until the next)",
	prompts: "Prompts: one row per prompt or injected context",
	session: "Session and workspace",
};

const STATUS_ICONS: Readonly<Record<FactStatus, string>> = {
	stored: "✅",
	pending: "🟡",
	not_recorded: "⚪",
	wrong: "🔴",
};

export const STATUS_WORDS: Readonly<Record<FactStatus, string>> = {
	stored: "stored",
	pending: "pending",
	not_recorded: "not recorded",
	wrong: "wrong",
};

/** What each status means (Markdown, as the matrix legend shows it). */
export const STATUS_LEGEND: Readonly<Record<FactStatus | "gap", string>> = {
	stored:
		"Opaline stores it. `v6` is the transcript parser version that first stored it; `elsewhere` means another table (usage, run index, git observations), named in the details.",
	gap: "stored, but the agent also records it in a place we do not read yet; the details say where and which change will read it.",
	pending:
		"the agent records it and we do not store it yet; the details name the change that will (`parser 9` is the next transcript parser version).",
	not_recorded:
		"not found in the searched corpus; this is not proof the writer cannot emit it.",
	wrong:
		"stored, but known to be incorrect; the details say what is wrong and the fix.",
};

/** What "local census" in the details refers to. */
export const CENSUS_LEGEND = `"Local census" in the details is the ${LOCAL_CENSUS.replace(/^Census/u, "census")}; "locally" counts are from it too.`;

/** How the short source names read (Markdown). */
export const SOURCE_LEGEND =
	"`toolUseResult.x` is a field of a Claude Code tool result, `Bash input.x` a tool call's argument, `exec_command args.x` a Codex call's argument, `CommandExecution.x` a field of a Codex completed item, `output “…”` a convention at the start of a call's output text. `{*}` stands for a key that is data (a file path, an id, a model name).";

/** Rewrites from census paths to the short names the matrix shows. */
const SHORT_SOURCE_RULES: readonly (readonly [RegExp, string])[] = [
	[/^assistant\.message\.content\[tool_use:\*\]\./u, "tool_use."],
	[/^assistant\.message\.content\[tool_use:([^\]]+)\]\.input\./u, "$1 input."],
	[/^assistant\.message\.content\[tool_use:([^\]]+)\]\.input$/u, "$1 input"],
	[/^assistant\.message\.content\[([^\]]+)\]\./u, "$1 block."],
	[/^assistant\.message\./u, "message."],
	[/^user\.message\.content\[tool_result\]\./u, "tool_result."],
	[/^user\.message\.content\[text\]\.text/u, "user message"],
	[/^user\.message\.content\[([^\]]+)\]\./u, "user $1."],
	[/^user\.message\.content/u, "user message"],
	[/^user\.toolUseResult/u, "toolUseResult"],
	[/^(?:user|assistant)\./u, ""],
	[/^attachment\/([^.]+)\.attachment\./u, "$1 attachment ."],
	[/^system\/([^.]+)\./u, "system $1 ."],
	[/^response_item\/function_call:\*\./u, "function_call."],
	[/^response_item\/function_call:([^.@]+)\.arguments\./u, "$1 args."],
	[/^response_item\/function_call:([^.@]+)\./u, "$1 call."],
	[/^response_item\/custom_tool_call:\*\./u, "custom_tool_call."],
	[/^response_item\/custom_tool_call:([^.@]+)\./u, "$1 call."],
	[
		/^response_item\/(?:function_call|custom_tool_call)_output\.output(?:\[input_text\]\.text)?/u,
		"output",
	],
	[
		/^response_item\/message:([a-z]+)\.content\[(?:input|output)_text\]\.text/u,
		"$1 message text",
	],
	[/^response_item\/message:([a-z]+)\./u, "$1 message."],
	[/^response_item\/([a-z_]+)\./u, "$1."],
	[/^event_msg\/item_completed:\*\./u, "completed item."],
	[/^event_msg\/item_completed:([^.]+)\./u, "$1."],
	[/^event_msg\/([a-z_]+)\./u, "$1."],
	[/^event_msg\/([a-z_]+)$/u, "$1"],
	[/^([a-z_-]+)\/\./u, "$1."],
	[/^\*\./u, "every record ."],
	[/^\*@/u, "every record @"],
];

/** A census path in the matrix's short form. */
export function shortSource(source: string): string {
	let short = source;
	for (const [pattern, replacement] of SHORT_SOURCE_RULES) {
		if (pattern.test(short)) {
			short = short.replace(pattern, replacement);
			break;
		}
	}
	short = short.replace(/ \./gu, " ").replace(/~(.+)$/u, " “$1…”");
	return short.trim();
}

function code(text: string): string {
	return `\`${text.replaceAll("`", "'")}\``;
}

/** Sources of one agent's fact, short and without repeats. */
export function shortSources(fact: AgentFact): string[] {
	return [...new Set(fact.sources.map(shortSource))];
}

/** `v6` (the parser version that first stored it), `elsewhere`, or nothing. */
export function versionLabel(fact: AgentFact): string {
	if (fact.status !== "stored" && fact.status !== "wrong") return "";
	if (
		fact.stores.since !== undefined &&
		(fact.stores.facts ?? fact.stores.record)
	)
		return `v${fact.stores.since}`;
	return fact.stores.elsewhere === undefined ? "" : "elsewhere";
}

/** One agent's table cell: status, version, and up to two short sources. */
function cell(fact: AgentFact): string {
	const parts = [STATUS_ICONS[fact.status]];
	const label =
		fact.status === "not_recorded" ? "not recorded" : versionLabel(fact);
	if (fact.status === "pending") parts.push("pending");
	else if (fact.status === "wrong") parts.push(`wrong ${label}`.trim());
	else if (label !== "") parts.push(label);
	if (
		(fact.status === "stored" || fact.status === "wrong") &&
		fact.gap !== undefined
	)
		parts.push("+ gap");
	parts.push(`${fact.relation.kind} · ${mappingConfidence(fact)}`);
	const sources = shortSources(fact);
	const shown = sources.slice(0, 2).map(code).join(", ");
	const more = sources.length > 2 ? ` +${sources.length - 2}` : "";
	return shown === ""
		? parts.join(" ")
		: `${parts.join(" ")}<br>${shown}${more}`;
}

function escapeCell(text: string): string {
	return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function factName(entry: FactEntry): string {
	return [entry.id, ...(entry.also ?? [])].map(code).join(", ");
}

/** Details of one agent's fact: what it says beyond the cell. */
function agentDetail(fact: AgentFact): string[] {
	const counts = new Map<string, number>();
	for (const item of fact.evidence)
		counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
	const lines: string[] = [
		`Relation: ${relationLabel(fact.relation)}. Confidence: ${mappingConfidence(fact)}. Evidence: ${[...counts].map(([kind, count]) => `${kind} (${count})`).join(", ")}.`,
	];
	if (fact.justification !== undefined)
		lines.push(`Judgement: ${fact.justification}`);
	for (const source of fact.sourceMappings)
		lines.push(
			`Path: ${code(source.path)} — ${source.role} · ${relationLabel(source.relation)}.`,
		);
	if (fact.legacySources !== undefined)
		lines.push(
			`Legacy sources: ${fact.legacySources.map(code).join(", ")} (observed versions are in the legacy evidence ledger).`,
		);
	if (fact.conflict !== undefined) lines.push(`Conflict: ${fact.conflict}`);
	if (fact.status === "pending" || fact.status === "wrong")
		lines.push(`${fact.status === "wrong" ? "Fix" : "Plan"}: ${fact.plan}`);
	if (fact.status === "not_recorded")
		lines.push(`How we checked: ${howChecked(fact.searched)}`);
	if (
		(fact.status === "stored" || fact.status === "wrong") &&
		fact.gap !== undefined
	)
		lines.push(
			`Gap: also recorded at ${fact.gap.sources.map((source) => code(shortSource(source))).join(", ")}. Plan: ${fact.gap.plan}`,
		);
	if (
		(fact.status === "stored" || fact.status === "wrong") &&
		fact.stores.elsewhere !== undefined
	)
		lines.push(`Stored in ${fact.stores.elsewhere}.`);
	if (fact.notes !== undefined) lines.push(`Note: ${fact.notes}`);
	const sources = shortSources(fact);
	if (sources.length > 2)
		lines.push(`All sources: ${sources.map(code).join(", ")}.`);
	return lines;
}

/** How a `not_recorded` fact was checked, with the census named in the legend. */
export function howChecked(searched: string): string {
	return searched.replace(`${LOCAL_CENSUS}: `, "local census: ");
}

/** Facts per status for one agent, and how many stored ones have a gap. */
export function factStatusCounts(
	agent: FactAgent,
): Record<FactStatus | "gaps", number> {
	const result = { stored: 0, pending: 0, not_recorded: 0, wrong: 0, gaps: 0 };
	for (const entry of FACT_CATALOG) {
		const fact = entry.agents[agent];
		result[fact.status]++;
		if (fact.status === "stored" && fact.gap !== undefined) result.gaps++;
	}
	return result;
}

/** The matrix, as the committed docs/l1-fact-matrix.md must read. */
export function renderFactMatrix(): string {
	const lines: string[] = [
		"# L1 fact matrix: Claude Code and Codex",
		"",
		"<!-- Generated by `bun run --cwd packages/api-routes facts:matrix` from packages/api-routes/src/session-transcript/transcript-records/fact-catalog.ts. Do not edit by hand: change the catalog and regenerate. -->",
		"",
		"Every literal fact L1 knows about, what Claude Code and Codex each record for it, and what Opaline stores today. The columns are defined in the [L1 literal schema](l1-literal-schema.md); the catalog behind this page is checked by tests, and the drift census (`bun run --cwd packages/api-routes facts:census -- <transcripts>`) lists transcript fields no row accounts for.",
		"",
		"## Legend",
		"",
		`- ✅ **stored**: ${STATUS_LEGEND.stored}`,
		`- ✅ … **+ gap**: ${STATUS_LEGEND.gap}`,
		`- 🟡 **pending**: ${STATUS_LEGEND.pending}`,
		`- ⚪ **not recorded**: ${STATUS_LEGEND.not_recorded}`,
		`- 🔴 **wrong**: ${STATUS_LEGEND.wrong}`,
		"",
		CENSUS_LEGEND,
		"",
		`Under each status is where the agent records the fact, shortened: ${SOURCE_LEGEND}`,
		"",
		"## Summary",
		"",
		"| | Claude Code | Codex |",
		"|---|---:|---:|",
	];
	const byAgent = Object.fromEntries(
		FACT_AGENTS.map((agent) => [agent, factStatusCounts(agent)]),
	) as Record<FactAgent, ReturnType<typeof factStatusCounts>>;
	for (const status of ["stored", "pending", "not_recorded", "wrong"] as const)
		lines.push(
			`| ${STATUS_ICONS[status]} ${STATUS_WORDS[status]} | ${FACT_AGENTS.map(
				(agent) =>
					status === "stored" && byAgent[agent].gaps > 0
						? `${byAgent[agent][status]} (${byAgent[agent].gaps} with a gap)`
						: String(byAgent[agent][status]),
			).join(" | ")} |`,
		);
	lines.push("");
	lines.push(
		"Mapping quality (tier denominator: literal agent mappings including searched absences; derived/provenance are N/A, not searched absences; context paths are not sources):",
		"",
		"| Metric | Claude Code | Codex |",
		"|---|---:|---:|",
	);
	const metrics = FACT_AGENTS.map((agent) =>
		mappingMetrics(MAPPING_CATALOG, agent),
	);
	for (const tier of ["verified", "observed", "asserted"] as const)
		lines.push(
			`| ${tier} | ${metrics.map((metric) => `${metric.confidence[tier]} (${((100 * metric.confidence[tier]) / Math.max(1, metric.literal)).toFixed(1)}%)`).join(" | ")} |`,
		);
	for (const relation of [
		"unreviewed",
		"exact",
		"transform",
		"close",
		"broader",
		"narrower",
		"not_emitted",
		"not_found",
		"derived",
		"provenance",
	] as const)
		lines.push(
			`| ${relation} | ${metrics.map((metric) => metric.relations[relation]).join(" | ")} |`,
		);
	lines.push(
		`| N/A (derived/provenance) | ${metrics.map((metric) => metric.confidence.not_applicable).join(" | ")} |`,
		`| Context paths (excluded as sources) | ${metrics.map((metric) => metric.contextPaths).join(" | ")} |`,
		`| Judged (excludes searched absences) | ${metrics.map((metric) => metric.judged).join(" | ")} |`,
		`| Semantic conflicts | ${metrics.map((metric) => metric.conflicts).join(" | ")} |`,
		"| Paired runs | 0 | 0 |",
		"",
		"Unclassified census paths are computed from the selected corpus by facts:census / facts:review, not frozen into this matrix. No precision, false-absence rate or reviewer agreement is claimed without an independent gold set.",
		"",
	);
	lines.push("Primary-path relation counts (including recorded gaps):", "");
	for (const kind of Object.keys(metrics[0]?.pathRelations ?? {}))
		lines.push(
			`- ${kind}: ${metrics.map((metric) => Object.entries(metric.pathRelations).find(([relation]) => relation === kind)?.[1] ?? 0).join(" / ")} (Claude Code / Codex).`,
		);
	lines.push("");

	const decisions = FACT_CATALOG.filter(
		(entry) => entry.decision !== undefined,
	);
	const oracle = sourceOracleCoverage();
	const sourceCensus = sourceCensusCoverage(censusSnapshot.paths.codex);
	lines.push(
		"## Codex writer-source coverage",
		"",
		`Pinned writer: **${oracle.version}**, ${oracle.total} paths: ${oracle.mapped} mapped, ${oracle.ignored} ignored with a reason, ${oracle.context.length} context-only, ${oracle.pending.length} pending-review paths, **${oracle.residue.length} unassigned residue**. Context and pending review are not mapped sources.`,
		"",
		`Catalog source occurrences: ${oracle.declaredSources} declared, ${oracle.opaqueSources} covered only by open JSON, ${oracle.legacySources} explicitly legacy, ${oracle.missingSources.length} unsupported. Open JSON is not a declared child or meaning proof.`,
		"",
		`Local Codex census: ${sourceCensus.total} paths: ${sourceCensus.declared} declared, ${sourceCensus.opaque} open-JSON descendants, ${sourceCensus.tool_defined} tool-defined decoded arguments, ${sourceCensus.legacy} documented legacy, ${sourceCensus.unknown} unknown.`,
		"",
		"<details><summary>Writer-source residue (not a CI failure)</summary>",
		"",
		"| Path | Source | History modes |",
		"|---|---|---|",
	);
	for (const path of oracle.residue)
		lines.push(`| ${code(path.path)} | ${code(path.source)} | ${path.modes} |`);
	lines.push("", "</details>", "");
	lines.push(
		"<details>",
		`<summary>Pending residue review (${oracle.pendingReview.length} original disagreements; ${oracle.pending.length} uncovered writer paths)</summary>`,
		"",
		"| Path | Structural coverage | Sol proposal | Sonnet proposal |",
		"|---|---|---|---|",
	);
	for (const review of oracle.pendingReview)
		lines.push(
			`| ${code(review.path)}${review.path === review.reviewedPath ? "" : ` (corrected from ${code(review.reviewedPath)})`} | ${review.coverage} | ${escapeCell(review.sol)} | ${escapeCell(review.sonnet)} |`,
		);
	lines.push("", "</details>", "");
	lines.push("## Decisions needed", "");
	if (decisions.length === 0) lines.push("None.", "");
	else {
		decisions.forEach((entry, index) => {
			lines.push(
				`${index + 1}. **${factName(entry)}** (${entry.view}): ${entry.decision}`,
			);
		});
		lines.push("");
	}

	for (const view of FACT_VIEWS) {
		const entries = MAPPING_CATALOG.filter((entry) => entry.view === view);
		lines.push(
			`## ${VIEW_TITLES[view]}`,
			"",
			"| Fact | What it is | Claude Code | Codex | Comparability |",
			"|---|---|---|---|---|",
		);
		for (const entry of entries)
			lines.push(
				`| ${factName(entry)} | ${escapeCell(entry.meaning)} | ${escapeCell(cell(entry.agents.claude_code))} | ${escapeCell(cell(entry.agents.codex))} | ${COMPARABILITY_LABELS[factComparability(entry)]} |`,
			);
		lines.push("", "### Details", "");
		for (const entry of entries) {
			const agents = FACT_AGENTS.flatMap((agent) => {
				const detail = agentDetail(entry.agents[agent]);
				return detail.length === 0
					? []
					: [
							`  - ${AGENT_NAMES[agent]} ${STATUS_ICONS[entry.agents[agent].status]}: ${detail.join(" ")}`,
						];
			});
			const extra = [
				...(entry.alsoIn === undefined
					? []
					: [`  - Also a column of ${entry.alsoIn.join(", ")}.`]),
				...(entry.runIndex === undefined
					? []
					: [`  - Run index columns: ${entry.runIndex.map(code).join(", ")}.`]),
				...(entry.decision === undefined
					? []
					: [`  - Decision needed: ${entry.decision}`]),
			];
			if (agents.length === 0 && extra.length === 0) continue;
			lines.push(`- ${factName(entry)}`, ...agents, ...extra);
		}
		lines.push("");
	}
	return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}
