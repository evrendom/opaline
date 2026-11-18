import type { Digest, DigestInputs, Row } from "./retro-digest.js";
import { fmt } from "./retro-digest.js";
import {
	CALL_METRICS,
	type CallMetric,
	DIGEST_LIMITS,
	SEVERITY_EXAMPLES,
} from "./retro-digest-sql.js";

const num = (value: unknown) => Number(value ?? 0) || 0;
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

interface Limited {
	readonly row: (inputs: DigestInputs) => Row;
	readonly column: keyof typeof DIGEST_LIMITS;
	readonly total: (row: Row) => number;
	readonly sections: readonly string[];
	readonly line: (kept: string, total: string) => string;
}

const LIMITED: readonly Limited[] = [
	{
		row: (inputs) => inputs.sessions,
		column: "repeats",
		total: (row) => num(arr(row.repeat_totals)[0]),
		sections: ["g"],
		line: (kept, total) =>
			`repeated requests: the ids and example come from the first ${kept} of ${total} repeated texts; the counts include all`,
	},
	{
		row: (inputs) => inputs.sessions,
		column: "streams",
		total: (row) => num(row.streams_total),
		sections: ["h"],
		line: (kept, total) =>
			`subagents: ${kept} of ${total} subagent streams were read, so the sessions with subagents are a lower bound`,
	},
	{
		row: (inputs) => inputs.sessions,
		column: "models",
		total: (row) => num(row.models_total),
		sections: ["h"],
		line: (kept, total) => `models: the top ${kept} of ${total} were read`,
	},
	{
		row: (inputs) => inputs.sessions,
		column: "links",
		total: (row) => num(row.links_total),
		sections: ["h"],
		line: (kept, total) =>
			`session links: ${kept} of ${total} were read, so delegation and thread counts are lower bounds`,
	},
	{
		row: (inputs) => inputs.edits,
		column: "edits",
		total: (row) => num(row.edits_total),
		sections: ["a", "e", "i"],
		line: (kept, total) =>
			`edits: ${kept} of ${total} edit calls were read, so the edit counts here are lower bounds`,
	},
	{
		row: (inputs) => inputs.usage,
		column: "sub_spans",
		total: (row) => num(row.sub_spans_total),
		sections: ["c"],
		line: (kept, total) =>
			`subagent fan-out: ${kept} of ${total} subagent spans were read, so its counts are lower bounds`,
	},
	{
		row: (inputs) => inputs.usage,
		column: "compactions",
		total: (row) => num(row.compactions_total),
		sections: ["c"],
		line: (kept, total) =>
			`compactions: ${kept} of ${total} groups were read, so the total is a lower bound`,
	},
];

const RANKED: Readonly<
	Partial<Record<CallMetric, { section: string; what: string }>>
> = {
	refusals: { section: "a", what: "refusal reasons" },
	tools: { section: "d", what: "tools by time" },
	families: { section: "d", what: "command families by time" },
	families_n: { section: "d", what: "command families by calls" },
	loops: { section: "d", what: "wait and poll loops" },
	stopped: { section: "d", what: "stopped call kinds" },
	routes: { section: "e", what: "edit routes" },
	edit_basis: { section: "e", what: "edit bases" },
	inline_scripts: { section: "e", what: "inline script functions" },
	checks: { section: "f", what: "check kinds" },
};

export function digestCuts(inputs: DigestInputs): Map<string, string[]> {
	const cuts = new Map<string, string[]>();
	const add = (section: string, line: string) =>
		cuts.set(section, [...(cuts.get(section) ?? []), line]);
	for (const limited of LIMITED) {
		const row = limited.row(inputs);
		const kept = arr(row[limited.column]).length;
		const total = limited.total(row);
		if (kept < DIGEST_LIMITS[limited.column] || total <= kept) continue;
		for (const section of limited.sections)
			add(section, limited.line(fmt(kept), fmt(total)));
	}
	for (const metric of arr(inputs.calls.ranked)) {
		const [name, , keys] = arr(metric);
		const ranked = RANKED[String(name) as CallMetric];
		const limit = CALL_METRICS[String(name) as CallMetric]?.limit ?? 0;
		if (ranked && num(keys) > limit)
			add(
				ranked.section,
				`${ranked.what}: the top ${fmt(limit)} of ${fmt(num(keys))} were read`,
			);
	}
	const examplesCut = inputs.severity.some((shard) =>
		arr(shard.severity).some((rule) => {
			const tuple = arr(rule);
			return (
				arr(tuple[4]).length >= SEVERITY_EXAMPLES &&
				num(tuple[2]) > arr(tuple[4]).length
			);
		}),
	);
	if (examplesCut)
		add(
			"i",
			`severity examples: ${SEVERITY_EXAMPLES} per rule were kept; the counts include every hit`,
		);
	return cuts;
}

export function noteCuts(
	digest: Digest,
	cuts: ReadonlyMap<string, readonly string[]>,
): Digest {
	if (cuts.size === 0) return digest;
	return {
		...digest,
		sections: digest.sections.map((section) =>
			cuts.has(section.id)
				? { ...section, cuts: [...(cuts.get(section.id) ?? [])] }
				: section,
		),
	};
}
