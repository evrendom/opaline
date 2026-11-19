import type { SessionFileChanges } from "@rudel/api-routes";
import { getCurrentSessionDetailDerivation } from "../session-detail.service.js";
import { sessionFileChangesOf } from "./derivation-file-changes.js";

export async function getSessionFileChanges(input: {
	organizationId: string;
	ownerId: string;
	sessionId: string;
}): Promise<SessionFileChanges | null> {
	const derivation = await getCurrentSessionDetailDerivation(input);
	return derivation ? sessionFileChangesOf(derivation) : null;
}
