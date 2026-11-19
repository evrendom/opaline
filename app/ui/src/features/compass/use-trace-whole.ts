import { useQueries } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import type { SessionReaderStep } from "@/features/sessions/reader/model/session-reader-run-steps";
import { subagentIdOf } from "@/features/sessions/reader/subagents/session-reader-agent-focus";
import {
	ReaderSubagentsContext,
	subagentStepsQuery,
} from "@/features/sessions/reader/subagents/use-reader-subagent-branches";

export function useTraceWhole(allSteps: readonly SessionReaderStep[]): boolean {
	const context = useContext(ReaderSubagentsContext);
	const subagents = context?.subagents;
	const missing = useMemo(() => {
		const known = new Set(
			(subagents ?? [])
				.filter((subagent) => subagent.hasTranscript)
				.map((subagent) => subagent.subagentId),
		);
		return [
			...new Set(
				allSteps.flatMap((step) => {
					const id = subagentIdOf(step);
					return id !== null && known.has(id) && step.children.length === 0
						? [id]
						: [];
				}),
			),
		];
	}, [allSteps, subagents]);
	return useQueries({
		queries: missing.map((subagentId) => ({
			...subagentStepsQuery(context, subagentId),
			enabled: false,
		})),
		combine: (results) => results.every((result) => result.isError),
	});
}
