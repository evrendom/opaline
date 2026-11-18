import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { useNavigate } from "react-router-dom";
import { useSessionPlaces } from "../session-places";
import { useSessionReaderTab } from "../session-reader-tabs";
import { useCallHref } from "../summary/session-reader-summary-errors";
import { placeOf } from "./session-reader-context-by-run";
import type { ContextMap, ContextPart } from "./session-reader-context-map";
import type { ZoomOpen } from "./session-reader-context-zoom";

export function useContextOpen({
	map,
	runs,
	subagent,
}: {
	map: Pick<ContextMap, "trail">;
	runs?: readonly Pick<SessionDetailTurnSummary, "startedAt" | "turnId">[];
	subagent?: string;
}) {
	const { openFiles, openSetup, openTurn, selectTab } = useSessionReaderTab();
	const navigate = useNavigate();
	const callHref = useCallHref();
	const places = useSessionPlaces();
	const openAt = (run: string, step: string | null, inAgent?: string) =>
		step
			? navigate(
					callHref({ run, step, ...(inAgent ? { subagent: inAgent } : {}) }),
				)
			: openTurn(run);
	const zoomOpen: ZoomOpen = {
		detail: (
			part: Pick<ContextPart, "key" | "nested">,
			label: string | null,
		) => {
			const place = runs ? placeOf(map, runs, part, label) : null;
			if (!place) selectTab("detail");
			else openAt(place.run, place.step, subagent);
		},
		file: (path: string) => openFiles(path ? { file: path } : {}),
		mcpSetupFile: places?.mcpSetupFile,
		setup: (setupFile: string) => openSetup(setupFile),
		skillSetupFile: places?.skillSetupFile,
	};
	return {
		openAt: (run: string, step: string | null) => openAt(run, step),
		zoomOpen,
	};
}
