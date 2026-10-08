/**
 * Node ids of L1 edges (docs/l1-literal-schema.md, "Edges"): components are
 * percent-encoded and joined by `/`, so an id names its node exactly and a
 * session's ids share a key prefix. Run ids omit the transcript generation:
 * a raw record index stays stable while the transcript grows, so re-uploads
 * keep the same ids.
 */

export type L1NodeKind =
	| "run"
	| "session"
	| "commit"
	| "pull_request"
	| "ci_run";

export interface SessionIdentity {
	userId: string;
	source: string;
	sessionId: string;
}

function join(parts: readonly (string | number)[]): string {
	return parts.map((part) => encodeURIComponent(String(part))).join("/");
}

export function splitL1NodeId(id: string): string[] {
	return id.split("/").map((part) => decodeURIComponent(part));
}

/** The session part every run and session node id of a session starts with. */
export function sessionScopeId(session: SessionIdentity): string {
	return join([session.userId, session.source, session.sessionId]);
}

/** A run: its stream and the raw record index of the prompt that starts it. */
export function runNodeId(
	session: SessionIdentity,
	agentId: string,
	startRecord: number,
): string {
	return `${sessionScopeId(session)}/${join([agentId, startRecord])}`;
}

/** A session stream, for evidence that belongs to no run. */
export function sessionNodeId(
	session: SessionIdentity,
	agentId: string,
): string {
	return `${sessionScopeId(session)}/${join([agentId])}`;
}

export function commitNodeId(repositoryId: string, sha: string): string {
	return join([repositoryId, sha.toLowerCase()]);
}

export function pullRequestNodeId(
	repositoryId: string,
	number: number,
): string {
	return join([repositoryId, number]);
}

export function ciRunNodeId(
	repositoryId: string,
	kind: string,
	runId: string,
	attempt: number,
): string {
	return join([repositoryId, kind, runId, attempt]);
}

/**
 * The half-open key range `[from, to)` of every id that starts with
 * `prefix/`, for reading a session's edges by `from_id`.
 */
export function idPrefixRange(prefix: string): { from: string; to: string } {
	// `/` is followed by `0` in code point order, so this bounds the prefix.
	return { from: `${prefix}/`, to: `${prefix}0` };
}
