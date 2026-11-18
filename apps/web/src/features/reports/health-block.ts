const HEALTH_FENCE = /^```opaline-health[^\n]*\n([\s\S]*?)^```[ \t]*$/mu;

export interface HealthAction {
	rank: number | null;
	title: string;
	why: string;
	impact: string;
	effort: string;
}

export interface HealthSignal {
	label: string;
	status: string;
	area: string;
}

export interface HealthBlock {
	summary: string | null;
	actions: HealthAction[];
	signals: HealthSignal[];
}

export function splitHealthBlock(markdown: string): {
	markdown: string;
	health: HealthBlock | null;
} {
	const match = HEALTH_FENCE.exec(markdown);
	if (!match) return { markdown, health: null };
	const health: HealthBlock = { summary: null, actions: [], signals: [] };
	for (const line of (match[1] ?? "").split("\n")) {
		const record = parseLine(line);
		if (!record) continue;
		if (record.type === "Summary" && health.summary === null)
			health.summary = text(record.headline);
		if (record.type === "Action")
			health.actions.push({
				rank: typeof record.rank === "number" ? record.rank : null,
				title: text(record.title),
				why: text(record.why),
				impact: text(record.impact),
				effort: text(record.effort),
			});
		if (record.type === "Signal")
			health.signals.push({
				label: text(record.label),
				status: text(record.status),
				area: text(record.area),
			});
	}
	health.actions.sort(
		(left, right) =>
			(left.rank ?? Number.MAX_SAFE_INTEGER) -
			(right.rank ?? Number.MAX_SAFE_INTEGER),
	);
	return {
		markdown:
			`${markdown.slice(0, match.index)}${markdown.slice(match.index + match[0].length)}`.trim(),
		health,
	};
}

function parseLine(line: string): Record<string, unknown> | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try {
		const value: unknown = JSON.parse(trimmed);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}
