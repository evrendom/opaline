import {
	type RunCiByTurnStart,
	type RunCiRun,
	runCiByTurnStart,
	type SessionDetailTurnSummary,
	type SessionRunCiRun,
	turnRunCi,
} from "@rudel/api-routes";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { useReadsSessionData } from "./use-reads-session-data";

const RUN_CI_STALE_TIME_MS = 60 * 1000;

export type SessionRunCi = RunCiByTurnStart;

const EMPTY: SessionRunCi = new Map();

const NO_RUNS: readonly SessionRunCiRun[] = [];

export function useSessionCiRuns(
	sessionId: string,
): readonly SessionRunCiRun[] {
	return useRunCiQuery(sessionId).data?.runs ?? NO_RUNS;
}

export type SessionCiState =
	| { status: "pending" }
	| { status: "error" }
	| { enabled: boolean; runs: readonly SessionRunCiRun[]; status: "ready" };

export type CiAccess = "on" | "off" | "unknown";

export function ciAccessOf(state: SessionCiState): CiAccess {
	if (state.status !== "ready") return "unknown";
	return state.enabled ? "on" : "off";
}

export function useCiAccess(sessionId: string): CiAccess {
	return ciAccessOf(useSessionCi(sessionId));
}

export function useSessionCi(sessionId: string): SessionCiState {
	const { data, fetchStatus, isError } = useRunCiQuery(sessionId);
	return useMemo((): SessionCiState => {
		if (data)
			return { enabled: data.enabled, runs: data.runs, status: "ready" };
		if (isError) return { status: "error" };
		if (fetchStatus === "idle")
			return { enabled: false, runs: NO_RUNS, status: "ready" };
		return { status: "pending" };
	}, [data, fetchStatus, isError]);
}

export function useSessionRunCi(sessionId: string): SessionRunCi {
	const query = useRunCiQuery(sessionId);
	return useMemo(() => {
		const runs = query.data?.runs ?? [];
		return runs.length === 0 ? EMPTY : runCiByTurnStart(runs);
	}, [query.data]);
}

export function sessionRunCiQuery(
	organizationId: string | undefined,
	sessionId: string,
) {
	const options = orpc.analytics.sessions.runCi.queryOptions({
		input: { sessionId },
	});
	return queryOptions({
		queryFn: options.queryFn,
		queryKey: ["org", organizationId, ...options.queryKey],
		retry: false,
		staleTime: RUN_CI_STALE_TIME_MS,
	});
}

function useRunCiQuery(sessionId: string) {
	const reads = useReadsSessionData();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	return useQuery({
		...sessionRunCiQuery(organizationId, sessionId),
		enabled: reads && !!organizationId && sessionId.length > 0,
		refetchInterval: (current) =>
			current.state.data?.runs.some((run) =>
				run.ci.some((ci) => ci.conclusion === null),
			)
				? RUN_CI_STALE_TIME_MS
				: false,
	});
}

export const ReaderRunCiContext = createContext<SessionRunCi>(EMPTY);

export function useTurnCi(
	turn: Pick<SessionDetailTurnSummary, "startedAt">,
): readonly RunCiRun[] {
	const byStart = useContext(ReaderRunCiContext);
	return turnRunCi(byStart, turn);
}
