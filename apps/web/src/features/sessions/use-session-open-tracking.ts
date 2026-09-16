import { useEffect, useRef, useState } from "react";
import { useAnalyticsContext } from "@/features/analytics/tracking/useAnalyticsTracking";
import {
	captureDashboardLoadFailed,
	captureDashboardViewed,
} from "@/lib/product-analytics";
import {
	clearSessionOpenStart,
	elapsedMilliseconds,
	readSessionOpenStart,
} from "./session-open-timing";

interface InitialRequestTiming {
	request_duration_ms: number;
	response_processing_duration_ms: number;
}

export function useSessionOpenTracking(input: {
	sessionId: string;
	isLoading: boolean;
	error: unknown;
	hasData: boolean;
	cacheHit: boolean;
	requestTiming: InitialRequestTiming | undefined;
	turnCount: number | undefined;
}) {
	const analytics = useAnalyticsContext({ pageName: "session_detail" });
	const [start] = useState(() => readSessionOpenStart(input.sessionId));
	const [timing, setTiming] = useState<{
		load_duration_ms: number;
		error: unknown;
		requestTiming: InitialRequestTiming | undefined;
		turnCount: number | undefined;
	}>();
	const reported = useRef(false);
	const wasHidden = useRef(document.visibilityState !== "visible");

	useEffect(() => {
		clearSessionOpenStart(start);
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") wasHidden.current = true;
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, [start]);

	useEffect(() => {
		if (input.isLoading || timing || (!input.hasData && !input.error)) return;
		let secondFrame = 0;
		// Two frames give the committed initial detail view a paint opportunity.
		// This measures initial detail, not completion of background transcript pages.
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() =>
				setTiming({
					error: input.error,
					requestTiming: input.requestTiming,
					turnCount: input.turnCount,
					load_duration_ms: elapsedMilliseconds(
						start.startedAt,
						performance.now(),
					),
				}),
			);
		});
		return () => {
			cancelAnimationFrame(firstFrame);
			cancelAnimationFrame(secondFrame);
		};
	}, [
		input.isLoading,
		input.hasData,
		input.error,
		input.requestTiming,
		input.turnCount,
		start,
		timing,
	]);

	useEffect(() => {
		if (
			reported.current ||
			!timing ||
			!analytics.organizationId ||
			!analytics.userId
		)
			return;
		reported.current = true;
		const common = {
			page_name: "session_detail" as const,
			session_id: input.sessionId,
			date_range_days: analytics.dateRangeDays ?? 0,
			load_duration_ms: timing.load_duration_ms,
			load_start_source: start.startSource,
			cache_hit: input.cacheHit,
			was_backgrounded: wasHidden.current,
		};
		if (timing.error) {
			captureDashboardLoadFailed({
				...common,
				organization_id: analytics.organizationId,
				user_id: analytics.userId,
				query_name: "session_detail_initial",
				error_code:
					timing.error instanceof Error ? timing.error.name : "unknown",
				is_blocking: true,
				load_milestone: "initial_error_rendered",
			});
			return;
		}
		const requestTiming = !input.cacheHit ? timing.requestTiming : undefined;
		captureDashboardViewed({
			...common,
			has_data: true,
			load_milestone: "initial_detail_rendered",
			insight_count: null,
			turn_count: timing.turnCount ?? null,
			request_duration_ms: requestTiming?.request_duration_ms ?? null,
			response_processing_duration_ms:
				requestTiming?.response_processing_duration_ms ?? null,
		});
	}, [
		analytics.organizationId,
		analytics.userId,
		analytics.dateRangeDays,
		timing,
		start,
		input,
	]);
}
