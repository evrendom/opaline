import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";
import type { SessionReaderStep } from "../model/session-reader-model";
import { subagentTalkedTo } from "./session-reader-subagent-done";

const SUBAGENT_TINTS = [
	"var(--color-pink-500)",
	"var(--color-emerald-500)",
	"var(--color-amber-500)",
	"var(--color-sky-500)",
	"var(--color-fuchsia-500)",
	"var(--color-lime-500)",
	"var(--color-rose-500)",
	"var(--color-teal-500)",
] as const;

export function subagentTintAt(order: number): string {
	return SUBAGENT_TINTS[order % SUBAGENT_TINTS.length] as string;
}

const SubagentTintsContext = createContext<ReadonlyMap<string, string> | null>(
	null,
);

type TintedStep = Pick<SessionReaderStep, "kind"> &
	Partial<Pick<SessionReaderStep, "harness" | "notification" | "toolEvent">>;

export function reportingSubagentOf(step: TintedStep): string | null {
	const result = step.toolEvent?.result as { subagentId?: string } | null;
	if (step.kind === "agent" && result?.subagentId) return result.subagentId;
	if (step.harness === "notification" && step.notification?.agent)
		return step.notification.taskId;
	return null;
}

function getSubagentTints(ids: Iterable<string>): Map<string, string> {
	const tints = new Map<string, string>();
	for (const id of ids)
		if (!tints.has(id))
			tints.set(
				id,
				SUBAGENT_TINTS[tints.size % SUBAGENT_TINTS.length] as string,
			);
	return tints;
}

const SubagentFinishesContext = createContext<ReadonlyMap<
	string,
	number
> | null>(null);

export function SubagentTints({
	children,
	finishes,
	ids,
}: {
	children: ReactNode;
	finishes?: ReadonlyMap<string, number>;
	ids: readonly string[];
}) {
	const outer = useContext(SubagentTintsContext);
	const outerFinishes = useContext(SubagentFinishesContext);
	const tints = useMemo(() => outer ?? getSubagentTints(ids), [outer, ids]);
	return (
		<SubagentTintsContext.Provider value={tints}>
			<SubagentFinishesContext.Provider
				value={outerFinishes ?? finishes ?? null}
			>
				{children}
			</SubagentFinishesContext.Provider>
		</SubagentTintsContext.Provider>
	);
}

export type SubagentRole = "finish" | "launch" | "message";

const FINISH_SLACK_MS = 1_000;

export function useSubagentRole(
	step: Pick<
		SessionReaderStep,
		"harness" | "kind" | "notification" | "startMs" | "toolEvent"
	>,
): SubagentRole | null {
	const finishes = useContext(SubagentFinishesContext);
	const result = step.toolEvent?.result as { subagentId?: string } | null;
	if (step.kind === "agent" && result?.subagentId) return "launch";
	const id = subagentTalkedTo(step);
	if (!id) return null;
	if (step.harness !== "notification") return "message";
	const finish = finishes?.get(id);
	return finish !== undefined &&
		Math.abs(step.startMs - finish) <= FINISH_SLACK_MS
		? "finish"
		: "message";
}

export function useSubagentTint(step: TintedStep): string | null {
	return useSubagentTintOf()(step);
}

export function useSubagentFinishes(): ReadonlyMap<string, number> | null {
	return useContext(SubagentFinishesContext);
}

export function useSubagentTintById(): (
	id: string | null | undefined,
) => string | null {
	const tints = useContext(SubagentTintsContext);
	return useCallback(
		(id: string | null | undefined) => (id ? (tints?.get(id) ?? null) : null),
		[tints],
	);
}

export function useSubagentTintOf(): (step: TintedStep) => string | null {
	const tints = useContext(SubagentTintsContext);
	return useCallback(
		(step: TintedStep) => {
			const id = reportingSubagentOf(step) ?? subagentTalkedTo(step);
			return id ? (tints?.get(id) ?? null) : null;
		},
		[tints],
	);
}
