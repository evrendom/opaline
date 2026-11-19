import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { OpenSubagentContext } from "./session-reader-agent-focus";
import { SubagentTints } from "./session-reader-subagent-tints";

type Durations = ReadonlyMap<string, number | null | undefined>;

const NO_DURATIONS: Durations = new Map();

const SubagentModelsContext = createContext<ReadonlyMap<string, string>>(
	new Map(),
);

export function useSubagentModels(): ReadonlyMap<string, string> {
	return useContext(SubagentModelsContext);
}

export type SubagentFigures = {
	estimatedCost: number | null;
	gitActions?: Partial<Record<"commit" | "merge" | "pullRequest", number>>;
	inputTokens: number | null;
	model: string | null;
	outputTokens: number | null;
};

const SubagentFiguresContext = createContext<
	ReadonlyMap<string, SubagentFigures>
>(new Map());

export function useSubagentFigures(): ReadonlyMap<string, SubagentFigures> {
	return useContext(SubagentFiguresContext);
}

export function useSessionSubagents(
	turns: readonly SessionDetailTurnSummary[],
	subagents: readonly {
		durationSeconds?: number | null;
		estimatedCost?: number | null;
		gitActions?: SubagentFigures["gitActions"];
		inputTokens?: number | null;
		model?: string | null;
		outputTokens?: number | null;
		subagentId: string;
	}[],
) {
	const figures = useMemo(
		(): ReadonlyMap<string, SubagentFigures> =>
			new Map(
				subagents.map((subagent) => [
					subagent.subagentId,
					{
						estimatedCost: subagent.estimatedCost ?? null,
						gitActions: subagent.gitActions,
						inputTokens: subagent.inputTokens ?? null,
						model: subagent.model ?? null,
						outputTokens: subagent.outputTokens ?? null,
					},
				]),
			),
		[subagents],
	);
	const models = useMemo(
		(): ReadonlyMap<string, string> =>
			new Map(
				subagents.flatMap((subagent) =>
					subagent.model
						? [[subagent.subagentId, subagent.model] as const]
						: [],
				),
			),
		[subagents],
	);
	const durations = useMemo(
		(): Durations =>
			new Map(
				subagents.map((subagent) => [
					subagent.subagentId,
					subagent.durationSeconds,
				]),
			),
		[subagents],
	);
	const ids = useMemo(
		() =>
			turns.flatMap((turn) =>
				(turn.subagentEvents ?? []).flatMap((event) =>
					event.subagentId ? [event.subagentId] : [],
				),
			),
		[turns],
	);
	const finishes = useMemo(() => {
		const at = new Map<string, number>();
		for (const turn of turns)
			for (const event of turn.subagentEvents ?? []) {
				const id = event.subagentId;
				const seconds = id ? durations.get(id) : null;
				const launched = Date.parse(event.at);
				if (
					id &&
					seconds !== null &&
					seconds !== undefined &&
					Number.isFinite(launched) &&
					!at.has(id)
				)
					at.set(id, launched + seconds * 1000);
			}
		return at;
	}, [turns, durations]);
	return { durations, figures, finishes, ids, models };
}

export function PendingSubagentMarks({
	durations = NO_DURATIONS,
	turn,
}: {
	durations?: Durations;
	turn: SessionDetailTurnSummary;
}) {
	const start = turn.startedAt ? Date.parse(turn.startedAt) : Number.NaN;
	const end = turn.endedAt ? Date.parse(turn.endedAt) : Number.NaN;
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
		return null;
	const span = end - start;
	const seen = new Set<string>();
	const marks = (turn.subagentEvents ?? []).flatMap((event) => {
		const id = event.subagentId;
		const at = Date.parse(event.at);
		if (!id || seen.has(id) || !Number.isFinite(at)) return [];
		seen.add(id);
		const seconds = durations.get(id);
		const done = seconds ? at + seconds * 1000 : end;
		const from = Math.min(Math.max((at - start) / span, 0), 1);
		const to = Math.min(Math.max((done - start) / span, from), 1);
		return [{ from, id, ranOn: done > end ? done : undefined, to }];
	});
	if (marks.length === 0) return null;
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-0">
			{marks.map(({ from, id, ranOn, to }) => (
				<span
					key={id}
					data-subagent=""
					data-subagent-end-ms={ranOn}
					data-subagent-id={id}
					className="absolute inset-x-0"
					style={{ height: `${(to - from) * 100}%`, top: `${from * 100}%` }}
				>
					<span className="block h-0" />
				</span>
			))}
		</div>
	);
}

export function SessionSubagents({
	children,
	onOpen,
	subagents,
}: {
	children: ReactNode;
	onOpen: (subagentId: string) => void;
	subagents: ReturnType<typeof useSessionSubagents>;
}) {
	return (
		<SubagentTints finishes={subagents.finishes} ids={subagents.ids}>
			<SubagentModelsContext.Provider value={subagents.models}>
				<SubagentFiguresContext.Provider value={subagents.figures}>
					<OpenSubagentContext.Provider value={onOpen}>
						{children}
					</OpenSubagentContext.Provider>
				</SubagentFiguresContext.Provider>
			</SubagentModelsContext.Provider>
		</SubagentTints>
	);
}
