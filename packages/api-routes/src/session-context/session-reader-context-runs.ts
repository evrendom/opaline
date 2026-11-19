import type { SessionDetailTurnSummary } from "../schemas/session-detail-payload.js";
import type {
	SessionSetupFile,
	SessionSetupRun,
} from "../session-summary-links.js";
import type { ReadyBody } from "./session-reader-body.js";
import { getReaderMemberText } from "./session-reader-body.js";
import type { ContextRuns } from "./session-reader-context-before.js";
import { tokensOf } from "./session-reader-context-collect.js";
import {
	callContextTokens,
	getContextUseFill,
} from "./session-reader-context-fill.js";
import type { SessionReaderStep } from "./session-reader-run-steps.js";
import { getReaderWaterfall } from "./session-reader-run-steps.js";
import { setupName } from "./session-setup-name.js";

export function contextRuns(
	turns: readonly SessionDetailTurnSummary[],
	target: SessionDetailTurnSummary,
) {
	const end = turns.indexOf(target);
	let start = 0;
	for (let index = end; index >= 0; index -= 1)
		if ((turns[index]?.compactions ?? 0) > 0) {
			start = index;
			break;
		}
	return turns.slice(start, end + 1);
}

export function compactedRuns(
	turns: readonly SessionDetailTurnSummary[],
	target: SessionDetailTurnSummary,
) {
	const first = contextRuns(turns, target)[0];
	if (!first || (first.compactions ?? 0) === 0) return [];
	const end = turns.indexOf(first);
	let start = 0;
	for (let index = end - 1; index >= 0; index -= 1)
		if ((turns[index]?.compactions ?? 0) > 0) {
			start = index;
			break;
		}
	return turns.slice(start, end);
}

export function callBefore(
	turns: readonly SessionDetailTurnSummary[],
	target: SessionDetailTurnSummary,
) {
	for (let index = turns.indexOf(target) - 1; index >= 0; index -= 1) {
		const call = turns[index]?.usageCalls.at(-1);
		if (call) return { model: call.model, window: call.contextWindow };
	}
	return null;
}

export function firstCallInput(turn: SessionDetailTurnSummary): number | null {
	let first: (typeof turn.usageCalls)[number] | undefined;
	for (const call of turn.usageCalls)
		if (!first || Date.parse(call.at) < Date.parse(first.at)) first = call;
	return first ? callContextTokens(first) : null;
}

export function fullestCall(turn: SessionDetailTurnSummary) {
	let best: {
		at: number;
		model: string | null;
		share: number;
		tokens: number;
		window: number | null;
	} | null = null;
	for (const call of turn.usageCalls) {
		const tokens = callContextTokens(call);
		const fill = getContextUseFill({
			model: call.model,
			tokens,
			window: call.contextWindow,
		});
		if (fill && (!best || fill.share > best.share))
			best = {
				at: Date.parse(call.at),
				model: call.model,
				share: fill.share,
				tokens,
				window: call.contextWindow,
			};
	}
	return best;
}

export function sessionBaseline(
	turns: readonly SessionDetailTurnSummary[],
): number | null {
	let least = Number.POSITIVE_INFINITY;
	for (const turn of turns)
		for (const call of turn.usageCalls) {
			const tokens = callContextTokens(call);
			if (tokens > 0) least = Math.min(least, tokens);
		}
	if (!Number.isFinite(least)) return null;
	return Math.max(0, least - tokensOf(turns[0]?.userPreview));
}

export function runSetupFiles(
	files: readonly SessionSetupFile[],
	runs: readonly SessionSetupRun[],
	run: { agent: string | null; startedAt: string | null },
): SessionSetupFile[] {
	const start = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
	let latest = Number.NEGATIVE_INFINITY;
	if (!run.agent)
		for (const each of runs) {
			const at = Date.parse(each.startedAt);
			if (each.agentId === "" && at <= start && at > latest) latest = at;
		}
	const received = new Set(
		runs
			.filter((each) =>
				run.agent
					? each.agentId === run.agent
					: each.agentId === "" && Date.parse(each.startedAt) === latest,
			)
			.map((each) => each.setupFile),
	);
	return files.filter((file) => received.has(file.setupFile));
}

export function runSetupTexts(
	files: readonly SessionSetupFile[],
	runs: readonly SessionSetupRun[],
	run: { agent: string | null; startedAt: string | null },
): { chars: number; key: string; label: string }[] {
	return runSetupFiles(files, runs, run)
		.filter((file) => file.kind !== "skill_body")
		.map((file) => ({
			chars: file.chars,
			key: file.setupFile,
			label:
				file.scope === "mcp"
					? `${setupName(file)} MCP instructions`
					: file.scope === "harness"
						? setupName(file)
						: (file.path.split("/").pop() ?? setupName(file)),
		}));
}

export const NO_RUNS: ContextRuns = { prompts: [], steps: [] };

export function readRuns(
	runs: readonly ReadyBody<SessionDetailTurnSummary>[],
	model: string | null,
): ContextRuns {
	const prompts: string[] = [];
	const steps: SessionReaderStep[] = [];
	for (const [index, { body, turn }] of runs.entries()) {
		if (index > 0 || (turn.compactions ?? 0) === 0)
			prompts.push(getReaderMemberText(body));
		steps.push(...(getReaderWaterfall(body, turn, model)?.steps ?? []));
	}
	return { prompts, steps };
}
