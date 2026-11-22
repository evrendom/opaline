import { IconArrowUpRight } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router-dom";
import { StepIconChip } from "../detail/waterfall/session-reader-waterfall-chips";
import { mcpTool } from "../model/session-reader-mcp-tool";
import {
	formatReaderDuration,
	type SessionReaderBody,
} from "../model/session-reader-model";
import type { SessionReaderStep } from "../model/session-reader-run-steps";
import {
	CALL_PARAM,
	pickOf,
	SESSION_TAB_PARAM,
	writePick,
} from "../reader-params";
import {
	type CallRef,
	type ErrorImpact,
	errorImpact,
	type Failure,
	runErrors,
} from "./session-reader-run-errors";
import { ErrorChip, Row } from "./session-reader-summary-row";

export type RunCall = CallRef & { run: string };

type ToolFailed = {
	calls: RunCall[];
	key: string;
	ms: number | null;
	tool: string | null;
};

export type ErrorType = {
	key: string;
	label: string;
	quiet: boolean;
	what: ToolFailed[];
};

export const shortCallId = (id: string) =>
	id.replace(/^(?:toolu|call)_/u, "").slice(0, 4);

function toolOf(label: string): string {
	const [first = label, ...rest] = label.split(" ");
	if (/^[A-Z]/u.test(first) && rest.length > 0 && /\./u.test(rest.join(" ")))
		return first;
	return rest.length >= 2 && first.includes("-") ? rest.join(" ") : label;
}

export function errorTypes(
	impact: ErrorImpact,
	stuck: readonly (Failure & { streaks: number })[],
	run: string,
): ErrorType[] {
	const inRun = (calls: readonly CallRef[]) =>
		calls.map((call) => ({ ...call, run }));
	const byTool = <T,>(list: readonly T[], label: (each: T) => string) => {
		const out = new Map<string, T[]>();
		for (const each of list) {
			const tool = toolOf(label(each));
			out.set(tool, [...(out.get(tool) ?? []), each]);
		}
		return [...out];
	};
	const stuckTools = new Set(stuck.map((each) => toolOf(each.label)));
	const unresolved = byTool(impact.unresolved, (each) => each.label).map(
		([tool, list]): ToolFailed => ({
			calls: inRun(list.flatMap((each) => each.calls)),
			key: tool,
			ms: null,
			tool,
		}),
	);
	const all = (key: string, calls: readonly CallRef[]): ToolFailed[] => [
		{ calls: inRun(calls), key, ms: null, tool: null },
	];
	return [
		{
			key: "stuck",
			label: "Stuck",
			quiet: false,
			what: unresolved.filter((each) => stuckTools.has(each.key)),
		},
		{
			key: "never",
			label: "Never worked again",
			quiet: false,
			what: unresolved.filter((each) => !stuckTools.has(each.key)),
		},
		{
			key: "later",
			label: "Worked again later",
			quiet: false,
			what: byTool(impact.slow, (each) => each.label).map(([tool, list]) => ({
				calls: inRun(list.flatMap((each) => each.calls)),
				key: tool,
				ms: Math.max(...list.map((each) => each.ms)),
				tool,
			})),
		},
		{
			key: "quick",
			label: "Fixed right away",
			quiet: true,
			what: all("quick", impact.quick),
		},
		{
			key: "blocked",
			label: "Blocked or declined",
			quiet: true,
			what: all("blocked", impact.blocked),
		},
		{
			key: "exit",
			label: "Exit code only",
			quiet: true,
			what: all("exit", impact.exitOnly),
		},
	]
		.map((type) => ({
			...type,
			what: type.what.filter((each) => each.calls.length > 0),
		}))
		.filter((type) => type.what.length > 0);
}

export function errorTypesOf(body: SessionReaderBody, run: string) {
	return errorTypes(errorImpact(body), runErrors(body).stuck, run);
}

export const mcpServerOf = (step: SessionReaderStep) =>
	step.toolEvent ? mcpTool(step.toolEvent.toolName)?.server : null;

export function callHrefOf(
	searchParams: URLSearchParams,
	call: { run: string; step: string; subagent?: string },
) {
	const params = new URLSearchParams(searchParams);
	params.set(SESSION_TAB_PARAM, "detail");
	writePick(params, pickOf(call.run, call.subagent ?? null));
	params.set(CALL_PARAM, call.step);
	return `?${params}`;
}

export function useCallHref() {
	const [searchParams] = useSearchParams();
	return (call: { run: string; step: string; subagent?: string }) =>
		callHrefOf(searchParams, call);
}

export function CallLinks({ calls }: { calls: readonly RunCall[] }) {
	const hrefOf = useCallHref();
	return calls.map((call) => (
		<Link
			key={call.step}
			to={hrefOf(call)}
			aria-label={`Open call ${shortCallId(call.native)} in the detail`}
			className="group/call inline-flex h-6 items-center gap-xxs corner-s bg-hover pr-xs pl-xs font-medium tabular-nums transition-colors hover:bg-hover dark:bg-hover dark:hover:bg-hover-strong"
		>
			<StepIconChip size="sm" step={call.shown} tip={false} />
			{mcpServerOf(call.shown) ? (
				<span className="ml-xs font-regular text-ink-3">
					{mcpServerOf(call.shown)}
				</span>
			) : null}
			<span className="ml-xs max-w-40 truncate">
				{call.shown.name.replace(/^[^:\s]+:/u, "")}
			</span>
			<span className="ml-xs font-regular text-ink-3">
				{shortCallId(call.native)}
			</span>
			<IconArrowUpRight
				aria-hidden="true"
				className="size-3 text-ink-3 transition-colors group-hover/call:text-ink"
			/>
		</Link>
	));
}

function ToolCalls({ what }: { what: readonly ToolFailed[] }) {
	return what.map((each) => (
		<span
			key={each.key}
			className="inline-flex flex-wrap items-center gap-s text-body-l text-ink"
		>
			{each.ms !== null ? (
				<span className="text-ink-3">
					after {formatReaderDuration(each.ms / 1000)}
				</span>
			) : null}
			<CallLinks calls={each.calls} />
		</span>
	));
}

export function ErrorTypeRows({ types }: { types: readonly ErrorType[] }) {
	return types.map((type) => (
		<Row
			key={type.key}
			chip={<ErrorChip quiet={type.quiet} />}
			label={type.label}
			reasons={type.what.map((each) => (
				<ToolCalls key={each.key} what={[each]} />
			))}
		/>
	));
}
