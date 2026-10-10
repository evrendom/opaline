/**
 * A run id cut to what tells runs apart within a session: a Claude UUID's
 * first part (`71c287b2-6e4f-…` → `71c287b2`), a Codex id's part after its
 * prefix (`codex-jjhkefoyq5v7` → `jjhkefoyq5v7`). A run is named by the turn
 * it answers, so this shortens turn ids too.
 */
export function shortRunId(runId: string): string {
	const id = runId.replace(/^codex-/, "");
	return id.split("-")[0] || id;
}

/**
 * A step's own id cut short the same way: a UUID's first part, or a provider
 * id's prefix and first eight characters (`toolu_019raFo3ug…` →
 * `toolu_019raFo3`, `rs_07b58aff2c…` → `rs_07b58aff`).
 */
export function shortStepId(id: string): string {
	const prefixed = /^([a-z]+_)(.+)$/.exec(id);
	if (prefixed) return `${prefixed[1]}${prefixed[2].slice(0, 8)}`;
	return shortRunId(id);
}
