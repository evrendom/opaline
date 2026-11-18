/**
 * Who reads whose sessions in a workspace (ADR 0004). Every member reads
 * every member's sessions and setup, personal setup included. A workspace
 * with the own-sessions-only option on keeps the older rule instead: a member
 * reads only their own sessions, an admin (or the owner) every member's. The
 * option lives in `organization.own_sessions_only`, defaults to off and is
 * not settable in settings.
 */
export interface SessionReader {
	userId: string;
	/** The reader's role in the workspace: owner, admin or member. */
	role: string;
	/** The workspace's own-sessions-only option. */
	ownSessionsOnly: boolean;
}

/** Whether the reader reads every member's sessions in the workspace. */
export function readsEverySession(reader: SessionReader): boolean {
	return (
		!reader.ownSessionsOnly ||
		reader.role === "owner" ||
		reader.role === "admin"
	);
}

/**
 * The one member whose sessions the reader reads, or null when they read
 * every member's sessions in the workspace.
 */
export function readableSessionOwner(reader: SessionReader): string | null {
	return readsEverySession(reader) ? null : reader.userId;
}

/** Whether the reader may read a session the given member owns. */
export function mayReadSession(
	reader: SessionReader,
	ownerId: string,
): boolean {
	return readsEverySession(reader) || ownerId === reader.userId;
}
