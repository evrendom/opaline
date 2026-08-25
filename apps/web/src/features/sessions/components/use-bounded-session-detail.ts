import type { SessionDetailWindowRequest } from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "@/lib/orpc";

export function useBoundedSessionDetail(sessionId: string) {
	const [windowState, setWindowState] = useState<{
		request: SessionDetailWindowRequest;
		sessionId: string;
	}>({
		request: { includeBodies: true, mode: "initial", sessionId },
		sessionId,
	});
	const overviewQuery = useQuery({
		...orpc.analytics.sessions.detailOverview.queryOptions({
			input: { sessionId },
		}),
		enabled: sessionId.length > 0,
	});
	const windowRequest =
		windowState.sessionId === sessionId
			? windowState.request
			: ({ includeBodies: true, mode: "initial", sessionId } as const);
	const windowQuery = useQuery({
		...orpc.analytics.sessions.detailWindow.queryOptions({
			input: windowRequest,
		}),
		enabled: sessionId.length > 0,
	});

	return {
		detailWindow: windowQuery.data,
		error: overviewQuery.error ?? windowQuery.error,
		isLoading: overviewQuery.isLoading || windowQuery.isLoading,
		navigate: (mode: "newer" | "older", cursor: string) => {
			setWindowState({
				request: { cursor, includeBodies: true, mode, sessionId },
				sessionId,
			});
		},
		overview: overviewQuery.data,
	};
}
