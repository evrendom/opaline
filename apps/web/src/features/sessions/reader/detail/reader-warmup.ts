import { type QueryClient, useQueryClient } from "@tanstack/react-query";
// biome-ignore lint/style/noRestrictedImports: queues idle work for the trace in view, as its steps change.
import { useEffect } from "react";
import { warmCodeHighlighter } from "@/components/conversation/code-highlight-cache";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../model/session-reader-model";
import { explainCommandQuery } from "./step/explain-command-query";
import { shellCommandParts } from "./step/session-reader-step-payloads";

const PER_TRACE = 60;
const PER_IDLE = 6;

const explained = new Set<string>();
const queue: string[] = [];
let highlighterWarm = false;
let handle: number | null = null;
let client: QueryClient | null = null;

function idle(run: (deadline?: IdleDeadline) => void) {
	return typeof requestIdleCallback === "function"
		? requestIdleCallback(run, { timeout: 3_000 })
		: window.setTimeout(run, 300);
}

function drain(deadline?: IdleDeadline) {
	handle = null;
	if (!highlighterWarm) {
		highlighterWarm = true;
		warmCodeHighlighter(
			document.documentElement.classList.contains("dark") ? "dark" : "light",
		);
	}
	for (
		let started = 0;
		started < PER_IDLE && queue.length > 0 && client;
		started++
	) {
		if (deadline && deadline.timeRemaining() < 4) break;
		const command = queue.shift() as string;
		void client.prefetchQuery(explainCommandQuery(command));
	}
	if (queue.length > 0) handle = idle(drain);
}

function warmStepDetail(
	queryClient: QueryClient,
	steps: readonly SessionReaderStep[],
) {
	client = queryClient;
	let added = 0;
	for (const step of steps) {
		if (added >= PER_TRACE) break;
		const event = step.toolEvent;
		const command = event ? shellCommandParts(event)?.full : undefined;
		if (!command || explained.has(command)) continue;
		explained.add(command);
		queue.push(command);
		added++;
	}
	if (handle === null && (queue.length > 0 || !highlighterWarm))
		handle = idle(drain);
}

export function useWarmStepDetail(waterfall: SessionReaderWaterfall | null) {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (waterfall) warmStepDetail(queryClient, waterfall.allSteps);
	}, [waterfall, queryClient]);
}
