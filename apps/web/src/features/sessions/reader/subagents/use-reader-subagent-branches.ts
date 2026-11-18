import {
	deriveTranscriptToolActivity,
	type SessionDetailOverview,
	type SessionDetailTraceItem,
	SessionDetailTraceItemSchema,
} from "@rudel/api-routes";
import {
	type QueryClient,
	type UseQueryResult,
	useQueries,
	useQuery,
} from "@tanstack/react-query";
import {
	createContext,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { buildConversationTrace } from "@/components/conversation/conversation-trace";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { parseConversations } from "@/lib/conversation-schema";
import { client } from "@/lib/orpc";
import {
	BODY_PRIORITY,
	type BodyPriority,
	raiseBodyPriority,
} from "../../components/body-request-scheduler";
import {
	type fetchSessionDetailInitial,
	fetchSessionDetailSubagent,
	fetchSessionDetailSubagentTrace,
	isSessionDetailStaleRevisionError,
	SESSION_DETAIL_BODY_CACHE_TIME_MS,
	SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	sessionDetailInitialQueryOptions,
	sessionDetailSubagentQueryKey,
	shouldRetrySessionDetailFastQuery,
} from "../../components/session-detail-fast-query";
import type { SessionReaderBody } from "../model/session-reader-model";
import {
	type AgentItem,
	getLaunchedSubagentKey,
} from "../model/session-reader-run-steps";

export type ReaderSubagents = {
	onStaleRevision: (error: unknown) => void;
	revision: string;
	sessionId: string;
	subagents: SessionDetailOverview["subagents"];
};

export const ReaderSubagentsContext = createContext<ReaderSubagents | null>(
	null,
);

const NO_BRANCHES: ReadonlyMap<string, readonly AgentItem[]> = new Map();
const NO_IDS: readonly string[] = [];

type StepsAnswer = { items: readonly SessionDetailTraceItem[] };

const stepsByAnswer = new WeakMap<StepsAnswer, AgentItem[]>();

const isAgentItem = (item: SessionDetailTraceItem): item is AgentItem =>
	item.kind === "agent";

function stepsOf(answer: StepsAnswer): AgentItem[] {
	const held = stepsByAnswer.get(answer);
	if (held) return held;
	const steps = answer.items.filter(isAgentItem).map((item) => ({
		...item,
		events: item.events.map((event) =>
			event.kind === "tool" && !event.activity
				? { ...event, activity: deriveTranscriptToolActivity(event) }
				: event,
		),
	}));
	stepsByAnswer.set(answer, steps);
	return steps;
}

function traceOfTranscript(content: string): SessionDetailTraceItem[] {
	return SessionDetailTraceItemSchema.array().parse(
		buildConversationTrace(parseConversations(content)).filter(
			(item) => item.kind === "agent",
		),
	);
}

function getSpawnedAgentPaths(body: SessionReaderBody | null): string[] {
	const paths = new Set<string>();
	for (const item of body?.responseItems ?? []) {
		if (item.kind !== "agent") continue;
		for (const event of item.events) {
			if (event.kind !== "tool" || event.toolName !== "spawn_agent") continue;
			const path = getLaunchedSubagentKey({ ...event, result: event.result });
			if (path) paths.add(path);
		}
	}
	return [...paths];
}

function getSessionAgentItems(
	turns: readonly { body: SessionReaderBody | null }[],
): AgentItem[] {
	return turns.flatMap((turn) =>
		(turn.body?.responseItems ?? []).filter(
			(item): item is AgentItem => item.kind === "agent",
		),
	);
}

function getLaunchedSubagentIds(
	items: readonly SessionReaderBody["responseItems"][number][],
	known: ReadonlySet<string>,
): string[] {
	const ids = new Set<string>();
	for (const item of items) {
		if (item.kind !== "agent") continue;
		for (const event of item.events) {
			const subagentId =
				event.kind === "tool" ? event.result?.subagentId : undefined;
			if (subagentId && known.has(subagentId)) ids.add(subagentId);
		}
	}
	return [...ids];
}

function only(ids: string[], focus: string | undefined): string[] {
	return focus && ids.includes(focus) ? [focus] : ids;
}

export function subagentStepsQuery(
	context: ReaderSubagents | null,
	subagentId: string,
) {
	const input = {
		revision: context?.revision ?? "",
		sessionId: context?.sessionId ?? "",
		subagentId,
	};
	return {
		gcTime: SESSION_DETAIL_BODY_CACHE_TIME_MS,
		queryFn: async ({
			signal,
		}: {
			signal: AbortSignal;
		}): Promise<StepsAnswer> => {
			try {
				const trace = await fetchSessionDetailSubagentTrace(input, signal);
				if (trace) return { items: trace.items };
				const raw = await fetchSessionDetailSubagent(input, signal);
				return { items: traceOfTranscript(raw.content) };
			} catch (error) {
				if (isSessionDetailStaleRevisionError(error)) {
					context?.onStaleRevision(error);
				}
				throw error;
			}
		},
		queryKey: [...sessionDetailSubagentQueryKey(input), "steps"],
		retry: shouldRetrySessionDetailFastQuery,
		staleTime: SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	};
}

export function prefetchSubagentSteps(
	queryClient: QueryClient,
	context: ReaderSubagents,
	subagentId: string,
) {
	if (
		!context.subagents.some(
			(subagent) =>
				subagent.subagentId === subagentId && subagent.hasTranscript,
		)
	)
		return;
	raiseBodyPriority(subagentId, BODY_PRIORITY.urgent);
	void queryClient.prefetchQuery(subagentStepsQuery(context, subagentId));
}

const answersOf = (results: UseQueryResult<StepsAnswer>[]) =>
	results.map((result) => result.data);

const childTurnsOf = (
	results: UseQueryResult<
		Awaited<ReturnType<typeof fetchSessionDetailInitial>>
	>[],
) => results.map((result) => result.data?.initialDetail.window?.turns);

const branchesByBody = new WeakMap<
	object,
	ReadonlyMap<string, readonly AgentItem[]>[]
>();

function sharedBranches(
	body: SessionReaderBody | null,
	branches: ReadonlyMap<string, readonly AgentItem[]>,
): ReadonlyMap<string, readonly AgentItem[]> {
	if (!body || branches.size === 0) return branches;
	const held = branchesByBody.get(body) ?? [];
	const same = held.find(
		(candidate) =>
			candidate.size === branches.size &&
			[...branches].every(([id, steps]) => candidate.get(id) === steps),
	);
	if (same) return same;
	branchesByBody.set(body, [branches, ...held].slice(0, 4));
	return branches;
}

export function useReaderSubagentBranches(
	body: SessionReaderBody | null,
	enabled: boolean,
	{
		focus,
		priority = BODY_PRIORITY.near,
	}: { focus?: string; priority?: BodyPriority } = {},
): ReadonlyMap<string, readonly AgentItem[]> {
	const context = useContext(ReaderSubagentsContext);
	const withTranscript = useMemo(
		() =>
			new Set(
				(context?.subagents ?? [])
					.filter((subagent) => subagent.hasTranscript)
					.map((subagent) => subagent.subagentId),
			),
		[context?.subagents],
	);
	const launched = useMemo(
		() =>
			only(
				getLaunchedSubagentIds(body?.responseItems ?? [], withTranscript),
				focus,
			),
		[body, withTranscript, focus],
	);
	const [nested, setNested] = useState<{
		body: SessionReaderBody | null;
		focus: string | undefined;
		ids: readonly string[];
	}>({ body, focus, ids: NO_IDS });
	const nestedIds =
		nested.body === body && nested.focus === focus ? nested.ids : NO_IDS;
	const ids = useMemo(
		() => [...new Set([...launched, ...nestedIds])],
		[launched, nestedIds],
	);
	useLayoutEffect(() => {
		if (!enabled) return;
		for (const id of ids) raiseBodyPriority(id, priority);
	}, [enabled, ids, priority]);
	const contents = useQueries({
		combine: answersOf,
		queries: ids.map((subagentId) => ({
			...subagentStepsQuery(context, subagentId),
			enabled: enabled && context !== null,
		})),
	});
	const spawnedPaths = useMemo(
		() => only(getSpawnedAgentPaths(body), focus),
		[body, focus],
	);
	const { state: organization } = useOrganization();
	const sessionId = context?.sessionId ?? "";
	const eager = enabled && priority < BODY_PRIORITY.idle;
	const relationships = useQuery({
		enabled:
			eager && spawnedPaths.length > 0 && Boolean(organization.activeOrg?.id),
		queryFn: () => client.analytics.sessions.detailRelationships({ sessionId }),
		queryKey: [
			"org",
			organization.activeOrg?.id,
			"session-native-relationships",
			sessionId,
		],
	});
	const childSessions = useMemo(() => {
		const byPath = new Map(
			(relationships.data?.children ?? []).flatMap((child) =>
				child.agentPath ? [[child.agentPath, child.sessionId] as const] : [],
			),
		);
		return spawnedPaths.flatMap((path) => {
			const childSessionId = byPath.get(path);
			return childSessionId ? [{ path, sessionId: childSessionId }] : [];
		});
	}, [relationships.data, spawnedPaths]);
	const childTurns = useQueries({
		combine: childTurnsOf,
		queries: childSessions.map((child) => ({
			...sessionDetailInitialQueryOptions(child.sessionId),
			enabled: eager,
		})),
	});
	const found = getLaunchedSubagentIds(
		contents.flatMap((data) => (data ? stepsOf(data) : [])),
		withTranscript,
	).filter((id) => !ids.includes(id));
	if (found.length > 0)
		setNested({ body, focus, ids: [...nestedIds, ...found] });
	return useMemo(() => {
		const branches = new Map<string, readonly AgentItem[]>();
		ids.forEach((subagentId, index) => {
			const data = contents[index];
			if (data) branches.set(subagentId, stepsOf(data));
		});
		childSessions.forEach((child, index) => {
			const turns = childTurns[index];
			if (turns) branches.set(child.path, getSessionAgentItems(turns));
		});
		return branches.size > 0 ? sharedBranches(body, branches) : NO_BRANCHES;
	}, [body, ids, childSessions, childTurns, contents]);
}
