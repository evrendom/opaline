import type { SessionDetailInitial } from "@rudel/api-routes";
import {
	assembleSessionDetailWindow,
	getSessionDetailOverviewPage,
	getSessionDetailSpine,
	type SessionDetailDerivation,
} from "./session-detail-derivation.service.js";

const INITIAL_WINDOW_BUDGET = {
	maxBytes: 1_000_000,
	maxTurnBytes: 750_000,
	maxTurns: 20,
};
const INITIAL_SPINE_MAX_BYTES = 500_000;

// All three views come from one already-authorized, revision-bound derivation.
export function buildSessionDetailInitial(
	derivation: SessionDetailDerivation,
	options: { bodyChunks?: boolean } = {},
): SessionDetailInitial {
	const spine = getSessionDetailSpine(derivation);
	const assembly = assembleSessionDetailWindow({
		budget: INITIAL_WINDOW_BUDGET,
		derivation,
		request: {
			...(options.bodyChunks ? { bodyChunks: true } : {}),
			includeBodies: true,
			mode: "initial",
			sessionId: derivation.overviewBase.session.sessionId,
		},
	});
	return {
		overview: getSessionDetailOverviewPage({ derivation, limit: 100 }),
		// Exceptionally large indexes retain their existing separate endpoint.
		spine:
			Buffer.byteLength(JSON.stringify(spine), "utf8") <=
			INITIAL_SPINE_MAX_BYTES
				? spine
				: null,
		window: assembly.window,
	};
}
