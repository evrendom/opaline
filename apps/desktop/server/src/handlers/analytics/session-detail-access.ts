import { ORPCError } from "@orpc/server";
import {
	mayReadSession,
	type SessionReader,
} from "../../services/session-visibility.js";

export function requireSessionDetailOwnerAccess(
	ownerId: string | null | undefined,
	reader: SessionReader,
) {
	if (!ownerId) {
		throw new ORPCError("NOT_FOUND");
	}
	// Refuses only in a workspace with the own-sessions-only option on.
	if (!mayReadSession(reader, ownerId)) {
		throw new ORPCError("FORBIDDEN", {
			message: "You can only view your own sessions",
		});
	}

	return ownerId;
}
