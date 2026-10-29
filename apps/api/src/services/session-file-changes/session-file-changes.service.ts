import type { SessionFileChanges } from "@rudel/api-routes";
import { getCurrentSessionDetailDerivation } from "../session-detail.service.js";
import type { SessionDetailDerivation } from "../session-detail-derivation.service.js";
import { capSessionFileChanges } from "./budget.js";
import { collectDerivationFileChanges } from "./file-changes.js";

const byDerivation = new WeakMap<SessionDetailDerivation, SessionFileChanges>();

export async function getSessionFileChanges(input: {
	organizationId: string;
	ownerId: string;
	sessionId: string;
}): Promise<SessionFileChanges | null> {
	const derivation = await getCurrentSessionDetailDerivation(input);
	if (!derivation) return null;
	const cached = byDerivation.get(derivation);
	if (cached) return cached;
	const changes = capSessionFileChanges(
		collectDerivationFileChanges(derivation),
	);
	byDerivation.set(derivation, changes);
	return changes;
}
