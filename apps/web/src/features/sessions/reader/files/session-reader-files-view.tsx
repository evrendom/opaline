import type { SessionRunStep } from "@rudel/api-routes";
import { absolutePath } from "@rudel/api-routes/call-paths";
import { IconAlertTriangle, IconFile, IconFileCode } from "@tabler/icons-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Bones } from "@/app/ui/bones";
import { EmptyState } from "@/components/dashboard/page-parts";
import { cn } from "@/lib/utils";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "../../components/use-session-detail-overview-pages";
import { useSessionFileChanges } from "../../use-session-file-changes";
import {
	FilesRail,
	RailEmptyPane,
	useFilesRailTags,
} from "../rail/session-reader-files-rail";
import {
	railLineKey,
	subagentIdsOf,
} from "../rail/session-reader-turn-rail-row";
import {
	FILE_PARAM,
	READ_PARAM,
	RUN_PARAM,
	SUBAGENT_PARAM,
	syncPick,
} from "../reader-params";
import { resolveSessionFile } from "../session-places";
import { FilesColumnsSample } from "../session-reader-samples";
import { READER_RAIL_BACKGROUND, useReaderPick } from "../session-reader-tabs";
import {
	SessionSubagents,
	useSessionSubagents,
} from "../subagents/session-reader-subagent-marks";
import type { OpenPlace } from "../summary/session-reader-summary-sections";
import { getSubagentLaunches } from "../summary/session-summary-model";
import { getRunFiles, touchOf } from "./session-files-model";
import { FileDetail } from "./session-reader-file-detail";
import { CARD } from "./session-reader-files-parts";
import { getReadExtents, useEditsByCall } from "./session-reader-run-trace";
import { SeenFile } from "./session-reader-seen-file";
import { SessionFiles, TouchedFiles } from "./session-reader-touched-files";

const NO_LINES: ReadonlySet<string> = new Set();

export function SessionReaderFilesView({
	model,
	onOpenTurn,
	overview,
}: {
	model?: string | null;
	onOpenTurn: OpenPlace;
	overview: NormalizedSessionDetailOverview;
}) {
	const query = useSessionFileChanges(
		overview.session.sessionId,
		overview.revision,
	);
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const subagents = useSessionSubagents(turns, overview.subagents);
	const launches = useMemo(() => getSubagentLaunches(turns), [turns]);
	const openSubagent = (subagentId: string) => {
		const turnId = launches.get(subagentId);
		if (turnId) onOpenTurn(turnId, subagentId);
	};
	const railTags = useFilesRailTags();
	const [searchParams, setSearchParams] = useSearchParams();
	const files = query.data?.files ?? [];
	const runFiles = useMemo(() => getRunFiles(files), [files]);
	const idle = useMemo(() => {
		const out = new Set<string>();
		for (const turn of turns) {
			const touch = runFiles.get(turn.turnId);
			if (!touch || touch.changed.size + touch.read.size === 0)
				out.add(railLineKey(turn.turnId, null));
			for (const subagentId of subagentIdsOf(turn)) {
				const own = touchOf(files, runFiles, turn.turnId, subagentId);
				if (!own || own.changed.size + own.read.size === 0)
					out.add(railLineKey(turn.turnId, subagentId));
			}
		}
		return out;
	}, [files, runFiles, turns]);
	const edits = useEditsByCall(files);
	const traces = useMemo(
		() =>
			new Map(
				(query.data?.runs ?? []).map((each) => [each.turnId, each.steps]),
			),
		[query.data],
	);
	const extents = useMemo(
		() =>
			getReadExtents(
				query.data?.files ?? [],
				(query.data?.runs ?? []).flatMap((each) => each.steps),
			),
		[query.data],
	);
	const roots = useMemo(
		() => [
			...new Set(
				(query.data?.runs ?? []).flatMap((each) =>
					each.steps.flatMap((step) =>
						step.directory ? [step.directory] : [],
					),
				),
			),
		],
		[query.data],
	);
	const { agent, run } = useReaderPick();
	const linked = searchParams.get(FILE_PARAM);
	const filePath = linked
		? absolutePath(linked, overview.session.projectPath)
		: null;
	const asked = filePath
		? resolveSessionFile(
				files.map((file) => file.path),
				filePath,
				{ absolute: "known" },
			)
		: null;
	const selected =
		files.find((file) => file.path === asked) ??
		(run || filePath
			? null
			: (files.find((file) => file.changes.length > 0) ?? null));
	const readId = searchParams.get(READ_PARAM);
	const allSteps = useMemo(() => [...traces.values()].flat(), [traces]);
	const readStep = useMemo(() => {
		if (!readId) return null;
		const step = (run ? traces.get(run) : allSteps)?.find(
			(each) => each.eventId === readId,
		);
		return step?.seen ? { seen: step.seen, step } : null;
	}, [allSteps, readId, run, traces]);
	const setPicks = (next: {
		agent?: string | null;
		file?: string | null;
		read?: string | null;
		run?: string | null;
	}) =>
		setSearchParams(
			(params) => {
				for (const [key, value] of [
					[FILE_PARAM, next.file],
					[RUN_PARAM, next.run],
					[
						SUBAGENT_PARAM,
						next.run !== undefined ? (next.agent ?? null) : next.agent,
					],
					[READ_PARAM, next.read ?? null],
				] as const) {
					if (value === undefined) continue;
					if (value === null) params.delete(key);
					else params.set(key, value);
				}
				syncPick(params);
				return params;
			},
			{ replace: true },
		);
	const pickRun = (turnId: string | null, subagent: string | null = null) =>
		setPicks({ agent: subagent, file: null, run: turnId });
	const pickStep = (step: SessionRunStep, picked?: string) => {
		if (step.kind === "read" && step.seen) {
			setPicks({ file: picked ?? step.paths[0] ?? null, read: step.eventId });
			return;
		}
		const edited = edits.get(step.eventId)?.path;
		const read =
			step.kind === "read"
				? step.paths.find((path) => files.some((file) => file.path === path))
				: undefined;
		const path = edited ?? read;
		const owner =
			run ?? [...traces].find(([, steps]) => steps.includes(step))?.[0] ?? null;
		if (path) setPicks({ file: path });
		else if (owner) onOpenTurn(owner, step.agentId || undefined);
	};
	const pickFile = (path: string) => {
		const touch = run ? touchOf(files, runFiles, run, agent) : undefined;
		const inRun = touch?.changed.has(path) || touch?.read.has(path);
		setPicks(inRun ? { file: path } : { file: path, run: null });
	};

	return (
		<div className="h-full overflow-hidden px-8 pt-2 pb-2">
			<SessionSubagents onOpen={openSubagent} subagents={subagents}>
				<div className="flex h-full min-h-0 gap-6">
					<div
						className={cn(
							"flex min-h-0 w-(--reader-rail) shrink-0 flex-col",
							READER_RAIL_BACKGROUND,
						)}
					>
						<FilesRail
							agent={agent}
							idle={query.isLoading ? NO_LINES : idle}
							model={model ?? null}
							onPickRun={pickRun}
							overview={overview}
							run={run}
							subagents={overview.subagents}
							tags={railTags}
							turns={turns}
						/>
					</div>
					{query.isError ? (
						<RailEmptyPane>
							<EmptyState
								icon={IconAlertTriangle}
								title="The files could not be read"
								description="Reading this session's file changes failed. Try the tab again in a moment."
							/>
						</RailEmptyPane>
					) : !query.isLoading && files.length === 0 ? (
						<RailEmptyPane>
							<EmptyState
								icon={IconFileCode}
								title="No files"
								description="This session wrote, edited or read no files."
							/>
						</RailEmptyPane>
					) : query.isLoading ? (
						<Bones
							fill
							className="min-w-0 flex-1"
							label="Reading the files this session touched"
						>
							<div className="flex h-full min-h-0 gap-6">
								<FilesColumnsSample
									agent={agent}
									model={model ?? null}
									run={run}
								/>
							</div>
						</Bones>
					) : (
						<>
							{run ? (
								<TouchedFiles
									agent={agent}
									edits={edits}
									extents={extents}
									hidden={railTags.hidden}
									file={selected?.path ?? null}
									files={files}
									model={model ?? null}
									onPickFile={pickFile}
									onPickStep={pickStep}
									read={readStep?.step.eventId ?? null}
									roots={roots}
									run={run}
									steps={traces.get(run) ?? []}
								/>
							) : (
								<SessionFiles
									edits={edits}
									extents={extents}
									file={selected?.path ?? null}
									files={files}
									hidden={railTags.hidden}
									model={model ?? null}
									onPickFile={pickFile}
									onPickStep={pickStep}
									read={readStep?.step.eventId ?? null}
									roots={roots}
									steps={allSteps}
								/>
							)}
							<div
								className={cn(
									"mt-(--panes-top) flex min-h-0 min-w-0 flex-1 overflow-hidden",
									CARD,
								)}
							>
								{readStep ? (
									<SeenFile
										key={readStep.step.eventId}
										agent={agent}
										onClearAgent={() => setPicks({ agent: null })}
										onClearRead={() => setPicks({ read: null })}
										onClearRun={() => setPicks({ run: null })}
										path={
											readStep.step.paths.find(
												(each) => each === selected?.path,
											) ??
											readStep.step.paths[0] ??
											""
										}
										run={run}
										seen={readStep.seen}
										step={readStep.step}
									/>
								) : selected ? (
									<FileDetail
										key={`${selected.path}:${run ?? ""}:${agent ?? ""}`}
										agent={agent}
										file={selected}
										onClearAgent={() => setPicks({ agent: null })}
										onClearFile={() => setPicks({ file: null })}
										onClearRun={() => setPicks({ run: null })}
										onOpenTurn={onOpenTurn}
										run={run}
									/>
								) : filePath ? (
									<p className="px-5 py-4 text-[13px] text-muted-foreground">
										<span className="font-mono">{filePath}</span> isn't among
										the files this session changed or read.
									</p>
								) : (
									<div className="flex min-w-0 flex-1 flex-col p-4">
										<EmptyState
											icon={IconFile}
											title="Pick a file"
											description="Pick a file on the left to see what the session did to it and what it read of it."
										/>
									</div>
								)}
							</div>
						</>
					)}
				</div>
			</SessionSubagents>
		</div>
	);
}
