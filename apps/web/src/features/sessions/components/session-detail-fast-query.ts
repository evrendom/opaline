import {
	SESSION_DETAIL_STALE_REVISION_CODE,
	SessionDetailInitialSchema,
	type SessionDetailSpine,
	SessionDetailSpineSchema,
	type SessionDetailSubagent,
	type SessionDetailTurn,
	SessionDetailTurnSchema,
	type SessionDetailWindow,
	type SessionDetailWindowRequest,
} from "@rudel/api-routes";
import { orpc } from "@/lib/orpc";
import {
	readSessionDetailBodyChunks,
	SessionDetailBodyIntegrityError,
} from "./session-detail-body-chunks";
import {
	assertExpectedSessionDetailRevision,
	logRecoveredSessionDetailShape,
	type ParsedSessionDetailOverview,
	parseSessionDetailOverviewResponse,
	parseSessionDetailSubagentResponse,
	parseSessionDetailWindowResponse,
	SessionDetailFastResponseError,
	SessionDetailFastRevisionMismatchError,
} from "./session-detail-fast-response";
import {
	hasSessionDetailErrorCode,
	runSessionDetailRequest,
	shouldRetrySessionDetailQuery,
} from "./session-detail-response";

const SESSION_DETAIL_FAST_QUERY_PREFIX = "session-detail-v2";
// A cold initial load prepares the whole transcript on the server. Very large
// sessions can exceed the normal page deadline before that preparation is cached.
const SESSION_DETAIL_INITIAL_TIMEOUT_MS = 90_000;
const SESSION_DETAIL_BODY_GC_TIME_MS = 10 * 60 * 1_000;
export const SESSION_DETAIL_OVERVIEW_STALE_TIME_MS = 60 * 1_000;
export const SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS = Number.POSITIVE_INFINITY;
export const SESSION_DETAIL_BODY_CACHE_TIME_MS = SESSION_DETAIL_BODY_GC_TIME_MS;
export const SESSION_DETAIL_WINDOW_CACHE_TIME_MS = 10 * 60 * 1_000;

export function sessionDetailInitialQueryKey(sessionId: string) {
	return [SESSION_DETAIL_FAST_QUERY_PREFIX, "initial", sessionId] as const;
}

export async function fetchSessionDetailInitial(
	sessionId: string,
	signal: AbortSignal,
) {
	const startedAt = performance.now();
	const response = await runSessionDetailRequest(
		(requestSignal) =>
			orpc.analytics.sessions.detailInitial.call(
				{ sessionId },
				{ signal: requestSignal },
			),
		signal,
		SESSION_DETAIL_INITIAL_TIMEOUT_MS,
	);
	const responseReceivedAt = performance.now();
	const initialDetail = SessionDetailInitialSchema.parse(response);
	if (initialDetail.overview.session.sessionId !== sessionId) {
		throw new SessionDetailFastResponseError(
			"The initial response belongs to another session.",
		);
	}
	const parsed = parseSessionDetailOverviewResponse(
		initialDetail.overview,
		sessionId,
	);
	return {
		...parsed,
		initialDetail,
		loadingTiming: {
			request_duration_ms: Math.round(responseReceivedAt - startedAt),
			response_processing_duration_ms: Math.round(
				performance.now() - responseReceivedAt,
			),
		},
	};
}

export function sessionDetailFirstOverviewQueryKey(sessionId: string) {
	return [
		SESSION_DETAIL_FAST_QUERY_PREFIX,
		"overview",
		sessionId,
		"latest",
		"first",
	] as const;
}

export function sessionDetailOverviewPageQueryKey(input: {
	revision: string;
	sessionId: string;
	turnCursor: string;
}) {
	return [
		SESSION_DETAIL_FAST_QUERY_PREFIX,
		"overview",
		input.sessionId,
		input.revision,
		input.turnCursor,
	] as const;
}

export function sessionDetailWindowQueryKey(
	input: SessionDetailWindowRequest,
	debugModeKey: string,
	initialRevision?: string,
) {
	return [
		SESSION_DETAIL_FAST_QUERY_PREFIX,
		"window",
		input.sessionId,
		debugModeKey,
		input,
		...(input.mode === "initial" && initialRevision ? [initialRevision] : []),
	] as const;
}

export function sessionDetailSpineQueryKey(input: {
	revision: string;
	sessionId: string;
}) {
	return [
		SESSION_DETAIL_FAST_QUERY_PREFIX,
		"spine",
		input.sessionId,
		input.revision,
	] as const;
}

export function sessionDetailWindowQueryPrefix(sessionId: string) {
	return [SESSION_DETAIL_FAST_QUERY_PREFIX, "window", sessionId] as const;
}

export function sessionDetailTurnQueryKey(input: {
	revision: string;
	sessionId: string;
	turnId: string;
}) {
	return [
		SESSION_DETAIL_FAST_QUERY_PREFIX,
		"body",
		input.sessionId,
		input.revision,
		"turn",
		input.turnId,
	] as const;
}

export function sessionDetailSubagentQueryKey(input: {
	revision: string;
	sessionId: string;
	subagentId: string;
}) {
	return [
		SESSION_DETAIL_FAST_QUERY_PREFIX,
		"body",
		input.sessionId,
		input.revision,
		"subagent",
		input.subagentId,
	] as const;
}

export function sessionDetailBodyQueryPrefix(sessionId: string) {
	return [SESSION_DETAIL_FAST_QUERY_PREFIX, "body", sessionId] as const;
}

export function sessionDetailRevisionQueryPrefix(
	sessionId: string,
	revision: string,
) {
	return [
		SESSION_DETAIL_FAST_QUERY_PREFIX,
		"overview",
		sessionId,
		revision,
	] as const;
}

export async function fetchSessionDetailOverview(
	input: {
		expectedRevision?: string;
		sessionId: string;
		turnCursor?: string;
	},
	querySignal: AbortSignal,
): Promise<ParsedSessionDetailOverview> {
	const response = await runSessionDetailRequest(
		(requestSignal) =>
			orpc.analytics.sessions.detailOverview.call(
				{
					sessionId: input.sessionId,
					...(input.turnCursor ? { turnCursor: input.turnCursor } : {}),
				},
				{ signal: requestSignal },
			),
		querySignal,
	);
	const parsed = parseSessionDetailOverviewResponse(response, input.sessionId);
	assertExpectedSessionDetailRevision(
		input.expectedRevision,
		parsed.overview.revision,
	);
	logRecoveredSessionDetailShape(
		"overview",
		input.sessionId,
		parsed.shapeIssueFields,
	);
	return parsed;
}

export async function fetchSessionDetailWindow(
	input: SessionDetailWindowRequest,
	querySignal: AbortSignal,
): Promise<SessionDetailWindow> {
	markSessionDetailWindowTiming("start");
	try {
		const response = await runSessionDetailRequest(
			(requestSignal) =>
				orpc.analytics.sessions.detailWindow.call(input, {
					signal: requestSignal,
				}),
			querySignal,
		);
		const parsed = parseSessionDetailWindowResponse(response);
		const expectedRevision =
			input.mode === "anchor" ? input.revision : undefined;
		assertExpectedSessionDetailRevision(
			expectedRevision,
			parsed.window.revision,
		);
		logRecoveredSessionDetailShape(
			"window",
			input.sessionId,
			parsed.shapeIssueFields,
		);
		return parsed.window;
	} finally {
		markSessionDetailWindowTiming("end");
	}
}

export async function fetchSessionDetailSpine(
	input: { revision: string; sessionId: string },
	querySignal: AbortSignal,
): Promise<SessionDetailSpine> {
	const response = await runSessionDetailRequest(
		(requestSignal) =>
			orpc.analytics.sessions.detailSpine.call(input, {
				signal: requestSignal,
			}),
		querySignal,
	);
	const spine = SessionDetailSpineSchema.parse(response);
	assertExpectedSessionDetailRevision(input.revision, spine.revision);
	return spine;
}

export async function fetchSessionDetailTurn(
	input: { revision: string; sessionId: string; turnId: string },
	querySignal: AbortSignal,
): Promise<SessionDetailTurn> {
	const response = await readSessionDetailBodyChunks(
		{
			kind: "turn",
			targetId: input.turnId,
			revision: input.revision,
			sessionId: input.sessionId,
		},
		querySignal,
		{ request: requestSessionDetailBodyChunk },
	);
	const result = SessionDetailTurnSchema.safeParse(response);
	if (!result.success || result.data.turnId !== input.turnId) {
		throw new SessionDetailBodyIntegrityError();
	}
	const parsed = result.data;
	assertExpectedSessionDetailRevision(input.revision, parsed.revision);
	return parsed;
}

export async function fetchSessionDetailSubagent(
	input: { revision: string; sessionId: string; subagentId: string },
	querySignal: AbortSignal,
): Promise<SessionDetailSubagent> {
	const response = await readSessionDetailBodyChunks(
		{
			kind: "subagent",
			targetId: input.subagentId,
			revision: input.revision,
			sessionId: input.sessionId,
		},
		querySignal,
		{ request: requestSessionDetailBodyChunk },
	);
	const parsed = parseSessionDetailSubagentResponse(response, input);
	assertExpectedSessionDetailRevision(input.revision, parsed.revision);
	return parsed;
}

function requestSessionDetailBodyChunk(
	input: Parameters<typeof orpc.analytics.sessions.detailBodyChunk.call>[0],
	querySignal: AbortSignal,
) {
	return runSessionDetailRequest(
		(signal) => orpc.analytics.sessions.detailBodyChunk.call(input, { signal }),
		querySignal,
	);
}

export function isSessionDetailStaleRevisionError(value: unknown) {
	return hasSessionDetailErrorCode(value, SESSION_DETAIL_STALE_REVISION_CODE);
}

export function shouldRetrySessionDetailFastQuery(
	failureCount: number,
	error: unknown,
) {
	if (
		error instanceof SessionDetailBodyIntegrityError ||
		error instanceof SessionDetailFastResponseError ||
		error instanceof SessionDetailFastRevisionMismatchError ||
		isSessionDetailStaleRevisionError(error)
	) {
		return false;
	}
	return shouldRetrySessionDetailQuery(failureCount, error);
}

function markSessionDetailWindowTiming(phase: "start" | "end") {
	if (!import.meta.env.DEV || typeof performance === "undefined") {
		return;
	}
	const mark = `transcript:window-fetch:${phase}`;
	performance.mark(mark);
	if (phase === "end") {
		performance.measure(
			"transcript:window-fetch",
			"transcript:window-fetch:start",
			mark,
		);
	}
}
