import type { SessionFileChanges } from "@rudel/api-routes";
import type { SessionDetailDerivation } from "../session-detail-derivation.service.js";
import { capSessionFileChanges } from "./budget.js";
import { collectDerivationFileChanges } from "./file-changes.js";

const byDerivation = new WeakMap<SessionDetailDerivation, SessionFileChanges>();

export function sessionFileChangesOf(
	derivation: SessionDetailDerivation,
): SessionFileChanges {
	const cached = byDerivation.get(derivation);
	if (cached) return cached;
	const changes = capSessionFileChanges(
		collectDerivationFileChanges(derivation),
	);
	byDerivation.set(derivation, changes);
	return changes;
}
