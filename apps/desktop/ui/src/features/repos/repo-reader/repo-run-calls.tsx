import type {
	RepositoryRun,
	RepositoryRunCall,
	RepositoryRunsOf,
	SessionFileChange,
	TraceEvent,
} from "@rudel/api-routes";
import { IconArrowUpRight } from "@tabler/icons-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { Reveal } from "@/app/ui/bones";
import { Pressable } from "@/app/ui/pressable";
import { EmptyState } from "@/components/dashboard/page-parts";
import { CodeSample } from "@/components/pierre/code-skeleton";
import { DiffView, languageForPath } from "@/components/pierre/diff-view";
import type { DiffHunk } from "@/components/pierre/line-diff";
import { diffLines } from "@/components/pierre/line-diff";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { CommandLines } from "@/features/sessions/reader/detail/step/session-reader-command-steps";
import { McpCall } from "@/features/sessions/reader/detail/step/session-reader-mcp-call";
import {
	type Payload,
	PayloadSection,
} from "@/features/sessions/reader/detail/step/session-reader-step-payload";
import {
	EditDiff,
	getToolResultView,
	ShellCommandBlock,
	shellCommandParts,
	ToolArguments,
} from "@/features/sessions/reader/detail/step/session-reader-step-payloads";
import {
	sizeHint,
	ToolCard,
} from "@/features/sessions/reader/detail/step/session-reader-tool-card";
import { wholeText } from "@/features/sessions/reader/files/session-files-model";
import { ChangeBlock } from "@/features/sessions/reader/files/session-reader-file-change";
import {
	Crumb,
	CrumbSeparator,
	ReaderPane,
	ReaderPaneHeader,
	ReaderPaneScroll,
} from "@/features/sessions/reader/files/session-reader-files-parts";
import {
	mcpResult,
	mcpTool,
} from "@/features/sessions/reader/model/session-reader-mcp-tool";
import type { SessionReaderTab } from "@/features/sessions/reader/reader-params";
import { shortRunId } from "@/features/sessions/run-id";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { useRepoRangeInput } from "./repo-page-data";

const STALE_TIME_MS = 5 * 60_000;
const PICKED_CALL_PARAM = "pickedCall";
const RUNS_STALE_TIME_MS = 5 * 60_000;

export function useRunCalls(
	repoKey: string | undefined,
	of: RepositoryRunsOf,
	run: RepositoryRun,
) {
	const range = useRepoRangeInput();
	return useAnalyticsQuery({
		...orpc.analytics.repositories.runCalls.queryOptions({
			input: {
				repoKey,
				of,
				range,
				sessionId: run.sessionId,
				agentId: run.agentId,
				startRecord: run.startRecord,
			},
		}),
		staleTime: STALE_TIME_MS,
	});
}

export function usePickedCall() {
	const [searchParams, setSearchParams] = useSearchParams();
	const picked = searchParams.get(PICKED_CALL_PARAM);
	const pick = (callKey: string | null) =>
		setSearchParams(
			(params) => {
				if (callKey) params.set(PICKED_CALL_PARAM, callKey);
				else params.delete(PICKED_CALL_PARAM);
				return params;
			},
			{ replace: true },
		);
	return [picked, pick] as const;
}

export function callKeyOf(call: RepositoryRunCall, index: number) {
	return call.callId || `load-${index}`;
}

export function callLabel(call: RepositoryRunCall): string {
	if (call.op === "skill") return call.callId ? "Skill call" : "Skill loaded";
	const tool = call.tool.startsWith("mcp__")
		? (call.tool.split("__").at(-1) ?? call.tool)
		: call.tool || "Call";
	if (call.op.toLowerCase() === tool.toLowerCase())
		return call.created ? `${tool} · created` : tool;
	if (call.op === "read") return `${tool} · read`;
	if (call.op.startsWith("inferred_"))
		return `${tool} · ${call.op.slice("inferred_".length)}, inferred`;
	if (call.created) return `${tool} · created`;
	if (call.op) return `${tool} · ${call.op}`;
	return tool;
}

export type CallFile = { path: string; commitSha: string };

export function RunCallCard({
	children,
	file,
	of,
	picked,
	repoKey,
	runKeyOf,
	sessionParams,
	sessionTab,
	onClear,
	split = false,
}: {
	children: ReactNode;
	file?: CallFile;
	of: RepositoryRunsOf | null;
	picked: string | null;
	repoKey: string | undefined;
	runKeyOf: (run: RepositoryRun) => string;
	sessionParams?: Record<string, string>;
	sessionTab: SessionReaderTab;
	onClear: () => void;
	split?: boolean;
}) {
	if (!of || !picked) return <>{children}</>;
	return (
		<PickedRunCard
			file={file}
			of={of}
			onClear={onClear}
			picked={picked}
			repoKey={repoKey}
			runKeyOf={runKeyOf}
			sessionParams={sessionParams}
			sessionTab={sessionTab}
			split={split}
		>
			{children}
		</PickedRunCard>
	);
}

function PickedRunCard({
	children,
	file,
	of,
	picked,
	repoKey,
	runKeyOf,
	sessionParams,
	sessionTab,
	onClear,
	split,
}: {
	children: ReactNode;
	file?: CallFile;
	of: RepositoryRunsOf;
	split: boolean;
	picked: string;
	repoKey: string | undefined;
	runKeyOf: (run: RepositoryRun) => string;
	sessionParams?: Record<string, string>;
	sessionTab: SessionReaderTab;
	onClear: () => void;
}) {
	const range = useRepoRangeInput();
	const query = useAnalyticsQuery({
		...orpc.analytics.repositories.runs.queryOptions({
			input: { repoKey, of, range },
		}),
		staleTime: RUNS_STALE_TIME_MS,
	});
	const run = query.data?.runs.find((each) => runKeyOf(each) === picked);
	if (!run) return <>{children}</>;
	const card = (
		<CallCard
			file={file}
			of={of}
			onClear={onClear}
			repoKey={repoKey}
			run={run}
			sessionParams={sessionParams}
			sessionTab={sessionTab}
		/>
	);
	if (!split) return card;
	return <SplitPanes top={children} bottom={card} />;
}

const SPLIT_KEY = "opaline.repo-call-split";
const SPLIT_LEAST = 0.2;
const SPLIT_MOST = 0.8;
const SPLIT_STEP = 0.05;

const clampShare = (share: number) =>
	Math.min(SPLIT_MOST, Math.max(SPLIT_LEAST, share));

function storedShare(): number {
	try {
		const stored = Number(window.localStorage.getItem(SPLIT_KEY));
		return Number.isFinite(stored) && stored > 0 ? clampShare(stored) : 0.5;
	} catch {
		return 0.5;
	}
}

function keepShare(share: number) {
	try {
		window.localStorage.setItem(SPLIT_KEY, String(share));
	} catch {}
}

function SplitPanes({ bottom, top }: { bottom: ReactNode; top: ReactNode }) {
	const box = useRef<HTMLDivElement>(null);
	const [share, setShare] = useState(storedShare);
	const [dragging, setDragging] = useState(false);
	const shareAt = (clientY: number) => {
		const rect = box.current?.getBoundingClientRect();
		return rect && rect.height > 0
			? clampShare((clientY - rect.top) / rect.height)
			: share;
	};
	const settle = (next: number) => {
		setShare(next);
		keepShare(next);
	};
	return (
		<div ref={box} className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div
				className="flex min-h-0 min-w-0 flex-col overflow-hidden"
				style={{ flex: `0 0 ${share * 100}%` }}
			>
				{top}
			</div>
			<hr
				aria-label="Resize the call pane"
				aria-orientation="horizontal"
				aria-valuemin={SPLIT_LEAST * 100}
				aria-valuemax={SPLIT_MOST * 100}
				aria-valuenow={Math.round(share * 100)}
				tabIndex={0}
				onPointerDown={(event) => {
					event.preventDefault();
					event.currentTarget.setPointerCapture(event.pointerId);
					setDragging(true);
				}}
				onPointerMove={(event) => {
					if (dragging) setShare(shareAt(event.clientY));
				}}
				onPointerUp={(event) => {
					if (!dragging) return;
					setDragging(false);
					settle(shareAt(event.clientY));
				}}
				onPointerCancel={() => setDragging(false)}
				onDoubleClick={() => settle(0.5)}
				onKeyDown={(event) => {
					const step =
						event.key === "ArrowUp"
							? -SPLIT_STEP
							: event.key === "ArrowDown"
								? SPLIT_STEP
								: 0;
					if (event.key === "Home") settle(SPLIT_LEAST);
					else if (event.key === "End") settle(SPLIT_MOST);
					else if (step) settle(clampShare(share + step));
					else return;
					event.preventDefault();
				}}
				data-resizing={dragging || undefined}
				className={cn(
					"relative z-10 h-px shrink-0",
					"edge-none",
					"cursor-row-resize touch-none select-none bg-line-soft outline-none transition-colors",
					"before:absolute before:inset-x-0 before:top-1/2 before:h-3 before:-translate-y-1/2",
					"hover:bg-focus",
					"focus-visible:bg-focus",
					"data-[resizing=true]:bg-focus",
				)}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{bottom}
			</div>
		</div>
	);
}

function CallCard({
	file,
	of,
	onClear,
	repoKey,
	run,
	sessionParams,
	sessionTab,
}: {
	file?: CallFile;
	of: RepositoryRunsOf;
	onClear: () => void;
	repoKey: string | undefined;
	run: RepositoryRun;
	sessionParams?: Record<string, string>;
	sessionTab: SessionReaderTab;
}) {
	const query = useRunCalls(repoKey, of, run);
	const fileQuery = useAnalyticsQuery({
		...orpc.analytics.repositories.file.queryOptions({
			input: {
				repoKey: repoKey ?? "",
				path: file?.path ?? "",
				commitSha: file?.commitSha ?? "",
			},
		}),
		enabled: file !== undefined && repoKey !== undefined,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const fileText = !file
		? undefined
		: fileQuery.isPending
			? undefined
			: fileQuery.data?.status === "text"
				? fileQuery.data.content
				: null;
	const [picked] = usePickedCall();
	const getShellRoutePath = useShellRoutePath();
	const calls = query.data?.calls ?? [];
	const index = Math.max(
		0,
		calls.findIndex((call, at) => callKeyOf(call, at) === picked),
	);
	const call = calls[index];
	const openRun = runHref(
		getShellRoutePath,
		repoKey,
		run,
		sessionTab,
		sessionParams,
	);
	return (
		<ReaderPane>
			<ReaderPaneHeader
				crumbs={
					<>
						<Crumb onClear={onClear}>
							Run {run.turnId ? shortRunId(run.turnId) : run.turn}
						</Crumb>
						{call ? (
							<>
								<CrumbSeparator />
								<Crumb title={call.path ?? undefined}>{callLabel(call)}</Crumb>
							</>
						) : null}
					</>
				}
			>
				<Link
					to={openRun}
					className={cn(
						"inline-flex h-6 items-center gap-xs",
						"corner-s px-m",
						"text-body-m font-medium",
						"text-ink-3 transition-colors",
						"hover:text-ink",
					)}
				>
					Open in session
					<IconArrowUpRight aria-hidden="true" className="size-3.5" />
				</Link>
			</ReaderPaneHeader>
			{call?.path && !file ? (
				<span
					className={cn(
						"[direction:rtl]",
						"-mt-xs pr-m pl-m",
						"truncate text-left text-body-m",
						"text-ink-3",
					)}
					title={call.path}
				>
					{`‎${call.path}‎`}
				</span>
			) : null}
			{!query.isPending && !call ? (
				<EmptyState
					icon={IconArrowUpRight}
					title="No call to show"
					description="This run touched it only indirectly. Open it in its session to see the whole run."
					className="mt-l"
				/>
			) : (
				<ReaderPaneScroll>
					<Reveal
						label="Loading the call"
						loading={query.isPending}
						sample={
							<div className="flex flex-col gap-m pt-m pb-xl">
								<CodeSample />
							</div>
						}
						sampleId="repo-call"
					>
						{() =>
							call ? (
								<CallBody
									call={call}
									file={file ? { path: file.path, text: fileText } : undefined}
									run={run}
								/>
							) : null
						}
					</Reveal>
				</ReaderPaneScroll>
			)}
		</ReaderPane>
	);
}

export function CallBody({
	call,
	file,
	run,
}: {
	call: RepositoryRunCall;
	file?: { path: string; text: string | null | undefined };
	run: Pick<RepositoryRun, "agentId">;
}) {
	const changes = useMemo(() => changesOf(call, run), [call, run]);
	const read = useMemo(() => readHunks(call), [call]);
	const language = call.path ? languageForPath(call.path) : null;
	if (file && changes.length === 0) return <FileCall call={call} file={file} />;
	if (changes.length > 0)
		return (
			<ol className="flex flex-col divide-y divide-line-soft pb-xl">
				{changes.map((change, index) => (
					<ChangeBlock
						// biome-ignore lint/suspicious/noArrayIndexKey: one call's edits, in order
						key={index}
						change={change}
						hunks={diffLines(change.before, change.after, {
							lineOffset: change.line ?? 1,
						})}
						language={language}
						onOpenTurn={() => {}}
					/>
				))}
			</ol>
		);
	return (
		<div className="flex flex-col gap-xl pt-m pb-xl">
			{read ? (
				<CallSection title="Read" cut={call.output?.cut}>
					<DiffView hunks={read} language={language} />
				</CallSection>
			) : (
				<CallPayloads call={call} />
			)}
			{call.loaded ? (
				<CallSection title="Loaded into the run" cut={call.loaded.cut}>
					<DiffView hunks={wholeText(call.loaded.text)} language="markdown" />
				</CallSection>
			) : null}
		</div>
	);
}

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

export function eventOf(call: RepositoryRunCall): ToolEvent {
	return {
		id: call.callId,
		input: call.input
			? (parsed(call.input.text) ?? { command: call.input.text })
			: {},
		kind: "tool",
		result: undefined,
		timestamp: call.at,
		toolName: call.tool,
	};
}

function cutHint(text: string, cut: boolean): string | undefined {
	return cut ? `${sizeHint(text)} · cut short` : undefined;
}

function CallPayloads({ call }: { call: RepositoryRunCall }) {
	const event = useMemo(() => eventOf(call), [call]);
	const shell = shellCommandParts(event);
	const mcp = shell ? null : mcpTool(event.toolName);
	if (shell || mcp) {
		const output = call.output?.text ?? null;
		const cut = Boolean(call.input?.cut || call.output?.cut);
		return (
			<div className="flex flex-col gap-s">
				<ToolCard
					call={
						shell ? (
							<CommandLines
								key={shell.full}
								command={shell.full}
								fallback={<ShellCommandBlock event={event} />}
								renderEdit={(edit) => <EditDiff edit={edit} />}
							/>
						) : (
							<McpCall event={event} />
						)
					}
					collapsible={!shell}
					command={shell?.full}
					fit
					output={shell ? output : mcpResult(output)}
					scrolls={false}
					wrapLines={!shell}
				/>
				{cut ? (
					<p className="text-body-m text-ink-3">
						Cut short here; the rest is in the session's transcript.
					</p>
				) : null}
			</div>
		);
	}
	const payloads: Payload[] = [];
	if (call.input) {
		const input = parsed(call.input.text);
		payloads.push(
			input && Object.keys(input).length > 0
				? {
						body: <ToolArguments event={event} />,
						hint: cutHint(call.input.text, call.input.cut),
						label: "Arguments",
						show: "body",
						value: JSON.stringify(input, null, 2),
					}
				: {
						hint: cutHint(call.input.text, call.input.cut),
						label: "Arguments",
						show: "text",
						value: readable(call.input.text),
					},
		);
	}
	if (call.output?.text) {
		const view = getToolResultView(event, call.output.text);
		const hint = cutHint(call.output.text, call.output.cut);
		payloads.push(
			view.language
				? {
						hint,
						label: "Result",
						language: view.language,
						show: "code",
						startLine: view.startLine,
						value: view.text,
					}
				: { hint, label: "Result", show: "text", value: view.text },
		);
	}
	return payloads.map((payload) => (
		<PayloadSection key={payload.label} className="px-zero" {...payload} />
	));
}

function CallSection({
	children,
	cut,
	title,
}: {
	children: ReactNode;
	cut?: boolean;
	title: string;
}) {
	return (
		<section className="flex flex-col gap-s">
			<h3 className="text-body-m font-medium text-ink-3">{title}</h3>
			{children}
			{cut ? (
				<p className="text-body-m text-ink-3">
					Cut short here; the rest is in the session's transcript.
				</p>
			) : null}
		</section>
	);
}

function parsed(text: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function readable(text: string): string {
	const value = parsed(text);
	if (!value) return text;
	if (typeof value.command === "string" && Object.keys(value).length <= 3)
		return value.command;
	return JSON.stringify(value, null, 2);
}

function changesOf(
	call: RepositoryRunCall,
	run: Pick<RepositoryRun, "agentId">,
): SessionFileChange[] {
	if (!call.input || call.op === "read") return [];
	const input = parsed(call.input.text);
	if (!input) return [];
	const base = {
		agentId: run.agentId,
		at: call.at,
		cut: call.input.cut,
		eventId: call.callId,
		failed: call.failed,
		line: null,
		turnId: null,
	};
	if (
		typeof input.old_string === "string" &&
		typeof input.new_string === "string"
	)
		return [
			{
				...base,
				after: input.new_string,
				before: input.old_string,
				operation: "edited",
				tool: "edit",
			},
		];
	if (Array.isArray(input.edits))
		return input.edits.flatMap((edit) =>
			edit &&
			typeof edit === "object" &&
			typeof (edit as Record<string, unknown>).old_string === "string" &&
			typeof (edit as Record<string, unknown>).new_string === "string"
				? [
						{
							...base,
							after: (edit as Record<string, string>).new_string,
							before: (edit as Record<string, string>).old_string,
							operation: "edited" as const,
							tool: "edit" as const,
						},
					]
				: [],
		);
	if (typeof input.content === "string")
		return [
			{
				...base,
				after: input.content,
				before: "",
				operation: call.created ? "created" : "edited",
				tool: "write",
			},
		];
	return [];
}

const NUMBERED_LINE = /^\s*(\d+)\t(.*)$/u;

function FileCall({
	call,
	file,
}: {
	call: RepositoryRunCall;
	file: { path: string; text: string | null | undefined };
}) {
	const isRead = call.op === "read" || call.op === "inferred_read";
	const text = file.text;
	const hunks = useMemo(
		() => (isRead && typeof text === "string" ? wholeText(text) : null),
		[isRead, text],
	);
	const lit = useMemo(
		() => (isRead && typeof text === "string" ? readLines(call, text) : null),
		[call, isRead, text],
	);
	if (!isRead)
		return (
			<p className="pt-l text-body-l text-ink-3">
				{call.tool === "Bash" || call.op.startsWith("inferred_")
					? "Changed by a shell command, so the exact edit wasn't recorded. Open the run in its session to see what it ran."
					: "This call's change wasn't recorded."}
			</p>
		);
	if (text !== undefined && (!hunks || !lit))
		return (
			<p className="pt-l text-body-l text-ink-3">
				The file's text isn't available to show what was read.
			</p>
		);
	return (
		<Reveal
			label="Loading the file"
			loading={text === undefined}
			sample={
				<div className="flex flex-col gap-m pt-m pb-xl">
					<CodeSample />
				</div>
			}
			sampleId="repo-call-read"
		>
			{() =>
				hunks && lit ? (
					<div className="flex flex-col gap-m pt-m pb-xl">
						{call.input ? (
							<ReadCommand
								key={call.callId}
								bash={call.tool === "Bash"}
								text={readable(call.input.text)}
							/>
						) : null}
						{lit.size === 0 ? (
							<p className="text-body-m text-ink-3">
								What it read couldn't be matched to today's file.
							</p>
						) : null}
						<DiffView
							hunks={hunks}
							language={languageForPath(file.path)}
							lit={lit}
						/>
					</div>
				) : null
			}
		</Reveal>
	);
}

function ReadCommand({ bash, text }: { bash: boolean; text: string }) {
	const [open, setOpen] = useState(false);
	const hunks = useMemo(() => wholeText(text), [text]);
	return (
		<div className="flex flex-col gap-xs corner-s bg-hover">
			<Pressable
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-s corner-s px-m py-s text-left text-body-m text-ink-3 transition-colors hover:text-ink"
			>
				<SelectorMark open={open} />
				View command
			</Pressable>
			{open ? (
				<div className="px-m pb-m">
					<DiffView hunks={hunks} language={bash ? "bash" : null} wrap />
				</div>
			) : null}
		</div>
	);
}

function SelectorMark({ open }: { open: boolean }) {
	const turn = cn(
		"[transform-box:fill-box] origin-center transition-transform duration-(--motion-duration) ease-base motion-reduce:transition-none",
		open && "-scale-y-100",
	);
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			className="size-3.5 shrink-0"
		>
			<path d="M8 9l4 -4l4 4" className={turn} />
			<path d="M16 15l-4 4l-4 -4" className={turn} />
		</svg>
	);
}

const GREP_LINE = /^(?:[^\s:]+:)?(\d+)[:-]/u;
const SED_RANGE = /sed\s+(?:-\w+\s+)*-n\s+['"]?(\d+),(\d+)p/u;

function readLines(call: RepositoryRunCall, text: string): Set<number> {
	const fileLines = text.split("\n");
	const output = (call.output?.text ?? "").replace(/\n$/u, "").split("\n");
	const enough = (count: number) =>
		count > 0 && count >= Math.max(1, Math.floor(output.length * 0.6));
	const numbered = output.flatMap((line) => {
		const match = NUMBERED_LINE.exec(line);
		return match ? [Number(match[1])] : [];
	});
	if (enough(numbered.length)) return new Set(numbered);
	const grepped = output.flatMap((line) => {
		const match = GREP_LINE.exec(line);
		return match ? [Number(match[1])] : [];
	});
	if (enough(grepped.length)) return new Set(grepped);
	const sed = SED_RANGE.exec(call.input?.text ?? "");
	if (sed) {
		const from = Number(sed[1]);
		const to = Math.min(Number(sed[2]), fileLines.length);
		return new Set(
			Array.from({ length: Math.max(0, to - from + 1) }, (_, at) => from + at),
		);
	}
	const where = new Map<string, number[]>();
	fileLines.forEach((line, at) => {
		const key = line.trim();
		if (key.length < 4) return;
		where.set(key, [...(where.get(key) ?? []), at + 1]);
	});
	const lit = new Set<number>();
	for (const line of output) {
		const hits = where.get(line.trim());
		if (hits && hits.length <= 3) for (const hit of hits) lit.add(hit);
	}
	return lit;
}

function readHunks(call: RepositoryRunCall): DiffHunk[] | null {
	if (call.op !== "read" || call.tool !== "Read" || !call.output) return null;
	const lines = call.output.text.replace(/\n$/u, "").split("\n");
	const first = NUMBERED_LINE.exec(lines[0] ?? "");
	if (!first) return null;
	const start = Number(first[1]);
	const text = lines
		.map((line) => NUMBERED_LINE.exec(line)?.[2] ?? line)
		.join("\n");
	return wholeText(text, start);
}

export function callTime(iso: string) {
	return new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function sessionPagePath(
	getShellRoutePath: (path: string) => string,
	repoKey: string | undefined,
	sessionId: string,
	params: URLSearchParams,
) {
	const path = repoKey
		? appRoutes.repoDetail(repoKey, sessionId)
		: appRoutes.sessionDetail(sessionId);
	const query = params.toString();
	if (!query) return getShellRoutePath(path);
	return `${getShellRoutePath(path)}${path.includes("?") ? "&" : "?"}${query}`;
}

export function runHref(
	getShellRoutePath: (path: string) => string,
	repoKey: string | undefined,
	run: RepositoryRun,
	sessionTab: SessionReaderTab,
	sessionParams?: Record<string, string>,
) {
	const params = new URLSearchParams(sessionParams);
	if (sessionTab !== "summary") params.set("sessionTab", sessionTab);
	if (run.agentId) {
		params.set("subagent", run.agentId);
		params.set("agent", run.agentId);
	} else if (run.turnId) {
		params.set("run", run.turnId);
		params.set("turn", run.turnId);
	}
	return sessionPagePath(getShellRoutePath, repoKey, run.sessionId, params);
}
