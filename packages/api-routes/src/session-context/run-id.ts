function firstPart(id: string): string {
	const bare = id.replace(/^codex-/, "");
	return bare.split("-")[0] || bare;
}

export function shortRunId(runId: string): string {
	return firstPart(runId).slice(0, 6);
}

/**
 * A step's own id cut short the same way: a UUID's first part, or a provider
 * id's prefix and first eight characters (`toolu_019raFo3ug…` →
 * `toolu_019raFo3`, `rs_07b58aff2c…` → `rs_07b58aff`).
 */
export function shortStepId(id: string): string {
	const prefixed = /^([a-z]+_)(.+)$/.exec(id);
	if (prefixed?.[1] && prefixed[2])
		return `${prefixed[1]}${prefixed[2].slice(0, 8)}`;
	return firstPart(id);
}

export function shortSubagentId(id: string): string {
	return id.slice(0, 4);
}
