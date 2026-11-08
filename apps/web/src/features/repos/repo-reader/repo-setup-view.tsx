import type {
	RepositoryListedSkill,
	RepositoryMcpTool,
	RepositoryRunsOf,
	RepositorySetupFile,
} from "@rudel/api-routes";
import { IconFileText, IconPlug, IconSparkles } from "@tabler/icons-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/dashboard/page-parts";
import { Skeleton as Bar } from "@/components/dashboard/skeleton";
import {
	FluidList,
	FluidListItem,
	useFluidListItem,
} from "@/components/fluid-list";
import { countChanges, diffLines } from "@/components/pierre/line-diff";
import { OpalChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import {
	CARD,
	ScrollColumn,
	ViewToggle,
} from "@/features/sessions/reader/files/session-reader-files-parts";
import { LANE_LOOK } from "@/features/sessions/reader/model/session-reader-step-lanes";
import { SetupCard } from "@/features/sessions/reader/setup/session-reader-setup-card";
import { SetupMark } from "@/features/sessions/reader/setup/session-reader-setup-column";
import {
	setupGroups,
	setupName,
	setupOwner,
} from "@/features/sessions/reader/setup/session-setup-files";
import { cn } from "@/lib/utils";
import { RunCallCard } from "./repo-run-calls";
import {
	RAIL_SHELF,
	RepoRunsColumn,
	RUNS_SHELF,
	runKeyOf,
	usePickedRun,
} from "./repo-runs-column";
import { RepoSetupSessionRail } from "./repo-setup-session-rail";
import {
	useRepoMcpTools,
	useRepoSetup,
	useRepoSetupSessions,
	useRepoSetupVersions,
} from "./use-repo-setup";

const SETUP_PARAM = "setup";
const TOOL_PARAM = "tool";

export type RepoSetupSection = "instructions" | "skills" | "mcp";

const SECTION_COPY: Record<
	RepoSetupSection,
	{
		empty: string;
		failed: string;
		icon: typeof IconFileText;
		pick: string;
		pickHint: string;
		title: string;
	}
> = {
	instructions: {
		title: "No instructions recorded",
		empty: "This repo's sessions received no instructions Opaline kept.",
		failed: "The instructions could not be read",
		icon: IconFileText,
		pick: "Pick an instruction file",
		pickHint:
			"Pick an instruction file on the left to read it and see the sessions that received it.",
	},
	mcp: {
		title: "No MCP servers recorded",
		empty: "This repo's sessions connected no MCP servers Opaline kept.",
		failed: "The MCP servers could not be read",
		icon: IconPlug,
		pick: "Pick an MCP server",
		pickHint:
			"Pick an MCP server on the left to see its tools and the runs that called it.",
	},
	skills: {
		title: "No skills recorded",
		empty: "This repo's sessions loaded no skills Opaline kept.",
		failed: "The skills could not be read",
		icon: IconSparkles,
		pick: "Pick a skill",
		pickHint:
			"Pick a skill on the left to read it and see the runs that loaded it.",
	},
};

type SkillHome = "repo" | "root";

function homeOf(file: RepositorySetupFile): SkillHome {
	return file.scope === "repository" ? "repo" : "root";
}

const LISTED_SCOPE = "listed";
const CALLED_SCOPE = "called";

type ListedSkillFile = {
	file: RepositorySetupFile;
	skill: RepositoryListedSkill;
};

function listedOnly(
	skills: readonly RepositoryListedSkill[],
	called: readonly RepositorySetupFile[],
): ListedSkillFile[] {
	const names = called.map((file) => setupName(file));
	return skills
		.filter(
			(skill) =>
				!names.some(
					(name) => skill.name === name || skill.name.endsWith(`:${name}`),
				),
		)
		.map((skill) => ({
			file: {
				chars: 0,
				firstAt: skill.lastAt,
				kind: "skill_body",
				lastAt: skill.lastAt,
				owner: "",
				path: `listed/${skill.name}/SKILL.md`,
				runs: 0,
				scope: LISTED_SCOPE,
				sessions: skill.sessions,
				setupFile: `${LISTED_SCOPE}:${skill.name}`,
				subagents: false,
				versions: 1,
			},
			skill,
		}));
}

function calledOnly(
	tools: readonly RepositoryMcpTool[],
	connected: readonly RepositorySetupFile[],
): RepositorySetupFile[] {
	const servers = new Map<string, { calls: number; sessions: number }>();
	for (const tool of tools) {
		if (connected.some((file) => toolsOf(file.owner, [tool]).length > 0))
			continue;
		const seen = servers.get(tool.server) ?? { calls: 0, sessions: 0 };
		servers.set(tool.server, {
			calls: seen.calls + tool.calls,
			sessions: Math.max(seen.sessions, tool.sessions),
		});
	}
	return [...servers]
		.sort(([a, x], [b, y]) => y.calls - x.calls || a.localeCompare(b))
		.map(([server, { sessions }]) => ({
			chars: 0,
			firstAt: "",
			kind: "mcp_instructions",
			lastAt: "",
			owner: server,
			path: "",
			runs: 0,
			scope: "mcp",
			sessions,
			setupFile: `${CALLED_SCOPE}:${server}`,
			subagents: false,
			versions: 1,
		}));
}

export type McpServer = {
	calls: number;
	connected: boolean;
	file: RepositorySetupFile;
	name: string;
	sessions: number;
	tools: { name: string; calls: number }[];
};

export function mcpServers(
	files: readonly RepositorySetupFile[],
	tools: readonly RepositoryMcpTool[],
): McpServer[] {
	const connected = files.filter((file) => sectionOf(file) === "mcp");
	return [
		...connected.map((file) => ({ connected: true, file })),
		...calledOnly(tools, connected).map((file) => ({
			connected: false,
			file,
		})),
	].map(({ connected: sent, file }) => {
		const used = toolsOf(file.owner, tools);
		return {
			calls: used.reduce((sum, tool) => sum + tool.calls, 0),
			connected: sent,
			file,
			name: setupName(file),
			sessions: file.sessions,
			tools: used,
		};
	});
}

function CalledServerCard({
	file,
	tools,
}: {
	file: RepositorySetupFile;
	tools: readonly { name: string; calls: number }[];
}) {
	const calls = tools.reduce((sum, tool) => sum + tool.calls, 0);
	return (
		<div className="flex min-w-0 flex-1 flex-col p-4">
			<EmptyState
				icon={IconPlug}
				title={`${setupName(file)} sent no instructions`}
				description={`Called ${calls.toLocaleString()} ${calls === 1 ? "time" : "times"} through ${tools.length} ${tools.length === 1 ? "tool" : "tools"} in the range, with no instructions Opaline kept.`}
			/>
		</div>
	);
}

function ListedSkillCard({ skill }: { skill: RepositoryListedSkill }) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<header className="flex flex-col gap-2 border-b border-border/50 px-5 py-4">
				<div className="flex min-w-0 items-center gap-2">
					<span className="flex shrink-0 opacity-60 grayscale">
						<SkillMarkGlyph />
					</span>
					<h2 className="min-w-0 truncate text-sm font-medium">{skill.name}</h2>
					<span className="shrink-0 text-xs text-muted-foreground">
						Loaded, never called
					</span>
				</div>
			</header>
			<div className="flex flex-col gap-3 px-5 py-4 text-[13px] leading-relaxed">
				{skill.description ? <p>{skill.description}</p> : null}
				<p className="text-xs text-muted-foreground">
					Offered in {skill.sessions}{" "}
					{skill.sessions === 1 ? "session" : "sessions"} of this repo in the
					range, never called.
				</p>
			</div>
		</div>
	);
}

function SkillMarkGlyph() {
	const Glyph = LANE_LOOK.skill.glyph;
	return (
		<OpalChip tint={LANE_LOOK.skill.tint} className="size-4 text-(--opal-tint)">
			<Glyph aria-hidden="true" className="size-2.5" />
		</OpalChip>
	);
}

function sectionOf(file: RepositorySetupFile): RepoSetupSection {
	if (file.kind === "skill_body") return "skills";
	if (file.kind === "mcp_instructions") return "mcp";
	return "instructions";
}

export function RepoSetupView({
	repoKey,
	section,
}: {
	repoKey: string;
	section: RepoSetupSection;
}) {
	const query = useRepoSetup(repoKey);
	const [searchParams, setSearchParams] = useSearchParams();
	const copy = SECTION_COPY[section];
	const mcpTools = useRepoMcpTools(repoKey, section === "mcp");
	const allFiles = query.data?.files;
	const sectionFiles = useMemo(() => {
		const connected = allFiles?.filter((file) => sectionOf(file) === section);
		return connected && section === "mcp" && mcpTools.data
			? [...connected, ...calledOnly(mcpTools.data.tools, connected)]
			: connected;
	}, [allFiles, mcpTools.data, section]);
	const [chosenHome, setHome] = useState<SkillHome | "all" | null>(null);
	const home =
		chosenHome ??
		(sectionFiles?.some((file) => homeOf(file) === "repo") ? "repo" : "root");
	const files =
		section === "mcp"
			? sectionFiles
			: sectionFiles?.filter((file) => home === "all" || homeOf(file) === home);
	const picked = searchParams.get(SETUP_PARAM);
	const groups = files ? setupGroups(files) : [];
	const repeated = repeatedSetupNames(groups.flatMap((group) => group.files));
	const listed = useMemo(
		() =>
			section === "skills"
				? listedOnly(query.data?.listedSkills ?? [], sectionFiles ?? [])
				: [],
		[query.data?.listedSkills, section, sectionFiles],
	);
	const shown =
		files?.find((file) => file.setupFile === picked) ??
		listed.find((each) => each.file.setupFile === picked)?.file;
	const shownListed = listed.find((each) => each.file === shown);
	const shownCalled = shown?.setupFile.startsWith(`${CALLED_SCOPE}:`) ?? false;
	const [pickedRun, pickRun] = usePickedRun();
	const versions = useRepoSetupVersions(
		repoKey,
		shown && !shownListed && !shownCalled ? shown.setupFile : "",
	);
	const shownTools =
		section === "mcp" && shown && mcpTools.data
			? toolsOf(shown.owner, mcpTools.data.tools)
			: [];
	const askedTool = searchParams.get(TOOL_PARAM);
	const pickedTool = shownTools.some((tool) => tool.name === askedTool)
		? askedTool
		: null;
	const runsOf: RepositoryRunsOf | null =
		shown && !shownListed && section !== "instructions"
			? section === "skills"
				? { kind: "setup", setupFile: shown.setupFile }
				: {
						kind: "mcp",
						server: shown.owner,
						...(pickedTool ? { tool: pickedTool } : {}),
					}
			: null;
	const pickTool = (tool: string) =>
		setSearchParams(
			(params) => {
				if (params.get(TOOL_PARAM) === tool) params.delete(TOOL_PARAM);
				else params.set(TOOL_PARAM, tool);
				params.delete("pickedRun");
				params.delete("pickedCall");
				return params;
			},
			{ replace: true },
		);
	const versionLabel = versions.chosen
		? `v${versions.numbers.get(versions.chosen)}`
		: null;
	const versionSessions = useRepoSetupSessions(
		repoKey,
		section !== "instructions" && versions.chosen && shown
			? shown.setupFile
			: "",
	);
	const chosenSessions = useMemo(
		() =>
			versions.chosen && versionSessions.data
				? new Set(
						versionSessions.data.sessions
							.filter((session) => session.version === versions.chosen)
							.map((session) => session.sessionId),
					)
				: null,
		[versions.chosen, versionSessions.data],
	);
	const pick = (setupFile: string) =>
		setSearchParams(
			(params) => {
				params.set(SETUP_PARAM, setupFile);
				params.delete(TOOL_PARAM);
				params.delete("pickedRun");
				params.delete("pickedCall");
				return params;
			},
			{ replace: true },
		);
	if (query.isPending) return <SetupSkeleton />;
	if (!sectionFiles || (sectionFiles.length === 0 && listed.length === 0))
		return (
			<div className="h-full pt-2 pr-8 pb-2 pl-6">
				<EmptyState
					icon={copy.icon}
					title={query.isError ? copy.failed : copy.title}
					description={
						query.isError
							? "Reading this repo's setup failed. Try the tab again in a moment."
							: copy.empty
					}
				/>
			</div>
		);
	return (
		<div className="h-full overflow-hidden pt-2 pr-8 pb-2 pl-6">
			<div className="flex h-full min-h-0 gap-6">
				<div className="-mb-2 flex min-h-0 w-[320px] shrink-0 flex-col gap-1.5">
					<div className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-muted/50 pr-1 pl-2 text-xs">
						<span className="shrink-0 font-medium">Entire repo</span>
						{section !== "mcp" ? (
							<span className="ml-auto">
								<ViewToggle
									label={`Which ${section} to list`}
									onPick={setHome}
									options={[
										{ id: "repo", label: "Repo" },
										{ id: "root", label: "Root" },
										{ id: "all", label: "All" },
									]}
									value={home}
								/>
							</span>
						) : null}
					</div>
					<ScrollColumn className="-mx-1 px-1 pb-8">
						<FluidList>
							{groups.map((group, groupIndex) => (
								<section key={group.label} className="flex flex-col gap-0.5">
									{groups.length > 1 ? (
										<h3 className="px-2.5 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">
											{group.label}
										</h3>
									) : null}
									{group.files.map((file, fileIndex) => (
										<Fragment key={file.setupFile}>
											<RepoSetupRow
												muted={
													section === "mcp" &&
													mcpTools.data !== undefined &&
													toolsOf(file.owner, mcpTools.data.tools).length === 0
												}
												file={file as RepositorySetupFile}
												index={
													groups
														.slice(0, groupIndex)
														.reduce((sum, each) => sum + each.files.length, 0) +
													fileIndex
												}
												isPicked={file === shown}
												meta={
													section === "mcp"
														? toolCount(
																mcpTools.data
																	? toolsOf(file.owner, mcpTools.data.tools)
																			.length
																	: 0,
															)
														: undefined
												}
												onPick={pick}
												root={
													repeated.has(setupName(file)) ? setupRoot(file) : null
												}
												showHome={home === "all"}
											/>
											{section === "mcp" ? (
												<Unfold
													open={
														file === shown &&
														mcpTools.data !== undefined &&
														toolsOf(file.owner, mcpTools.data.tools).length > 0
													}
												>
													<ToolRows
														onPick={pickTool}
														picked={pickedTool}
														tools={
															mcpTools.data
																? toolsOf(file.owner, mcpTools.data.tools)
																: []
														}
													/>
												</Unfold>
											) : (
												<Unfold
													open={file === shown && versions.versions.length > 1}
												>
													<VersionRows versions={versions} />
												</Unfold>
											)}
										</Fragment>
									))}
								</section>
							))}
							{listed.length > 0 ? (
								<section className="flex flex-col gap-0.5">
									{listed.map((each, at) => (
										<RepoSetupRow
											key={each.file.setupFile}
											muted
											file={each.file}
											index={
												groups.reduce(
													(sum, group) => sum + group.files.length,
													0,
												) + at
											}
											isPicked={each.file === shown}
											onPick={pick}
											showHome={false}
										/>
									))}
								</section>
							) : null}
						</FluidList>
					</ScrollColumn>
				</div>
				<div className={RUNS_SHELF}>
					{section === "instructions" ? (
						shown ? (
							<RepoSetupSessionRail
								file={shown}
								repoKey={repoKey}
								versionId={versions.chosen}
								versionLabel={versionLabel}
							/>
						) : (
							<RepoRunsColumn
								empty=""
								label="Sessions that received it"
								of={null}
								repoKey={repoKey}
							/>
						)
					) : (
						<RepoRunsColumn
							empty={
								section === "skills"
									? "No run loaded it"
									: "Connected, never called"
							}
							label={
								section === "skills"
									? "Runs that loaded it"
									: "Runs that called it"
							}
							of={runsOf}
							repoKey={repoKey}
							scope={
								shown
									? {
											name: [setupName(shown), versionLabel, pickedTool]
												.filter(Boolean)
												.join(" · "),
										}
									: undefined
							}
							sessions={chosenSessions}
						/>
					)}
					<div
						className={cn(
							"relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden",
							CARD,
						)}
					>
						<RunCallCard
							of={runsOf}
							onClear={() => pickRun(null)}
							picked={pickedRun}
							repoKey={repoKey}
							runKeyOf={runKeyOf}
							sessionParams={
								shown && section === "skills"
									? { setup: shown.setupFile }
									: undefined
							}
							sessionTab={section === "skills" ? "setup" : "detail"}
							split
						>
							{shownListed ? (
								<ListedSkillCard skill={shownListed.skill} />
							) : shown && shownCalled ? (
								<CalledServerCard file={shown} tools={shownTools} />
							) : shown ? (
								<div className="flex min-h-0 min-w-0 flex-1 flex-col">
									<SetupCard
										details={false}
										diffs
										file={shown}
										versions={versions}
										versionPicker={false}
									/>
								</div>
							) : (
								<div className="flex min-w-0 flex-1 flex-col p-4">
									<EmptyState
										icon={copy.icon}
										title={copy.pick}
										description={copy.pickHint}
									/>
								</div>
							)}
						</RunCallCard>
					</div>
				</div>
			</div>
		</div>
	);
}

function toolsOf(
	owner: string,
	tools: readonly RepositoryMcpTool[],
): { name: string; calls: number }[] {
	const key = owner.replace(/[^A-Za-z0-9_-]/gu, "_");
	const calls = new Map<string, number>();
	for (const tool of tools) {
		if (tool.server !== key && !tool.server.endsWith(`_${key}`)) continue;
		const name = tool.tool.split("__").at(-1) ?? tool.tool;
		calls.set(name, (calls.get(name) ?? 0) + tool.calls);
	}
	return [...calls]
		.map(([name, count]) => ({ name, calls: count }))
		.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

function toolCount(count: number): string | null {
	return count > 0 ? `${count} ${count === 1 ? "tool" : "tools"}` : null;
}

function ToolRows({
	onPick,
	picked,
	tools,
}: {
	onPick: (tool: string) => void;
	picked: string | null;
	tools: readonly { name: string; calls: number }[];
}) {
	if (tools.length === 0) return null;
	return (
		<ol aria-label="Tools called" className="ml-6 flex flex-col gap-0.5 pb-1">
			{tools.map((tool, index) => {
				const isPicked = tool.name === picked;
				return (
					<li key={tool.name}>
						<FluidListItem<HTMLButtonElement> index={20_000 + index}>
							{(item) => (
								<button
									type="button"
									ref={item.ref}
									aria-current={isPicked || undefined}
									onClick={() => onPick(tool.name)}
									onFocus={item.onFocus}
									className={cn(
										"relative flex w-full items-baseline gap-1.5 rounded-md py-1 pr-2.5 pl-3 text-left text-[11px] tabular-nums outline-none transition-colors corner-squircle squircle:rounded-xl",
										isPicked && "bg-muted",
									)}
								>
									<span
										className={cn(
											"min-w-0 truncate",
											isPicked ? "text-foreground" : "text-foreground/80",
										)}
									>
										{tool.name}
									</span>
									<span className="ml-auto shrink-0 text-muted-foreground">
										{tool.calls} {tool.calls === 1 ? "call" : "calls"}
									</span>
								</button>
							)}
						</FluidListItem>
					</li>
				);
			})}
		</ol>
	);
}

function Unfold({ children, open }: { children: ReactNode; open: boolean }) {
	const reduce = useReducedMotion() ?? false;
	return (
		<AnimatePresence initial={false}>
			{open ? (
				<motion.div
					key="unfold"
					className="overflow-hidden"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={{
						duration: reduce ? 0 : 0.2,
						ease: [0.32, 0.72, 0, 1],
					}}
				>
					{children}
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

function VersionRows({
	versions: { numbers, pick, shown, versions },
}: {
	versions: ReturnType<typeof useRepoSetupVersions>;
}) {
	const changes = useMemo(
		() =>
			new Map(
				versions.map((version, index) => {
					const previous = versions[index - 1];
					return [
						version.version,
						previous
							? countChanges(diffLines(previous.text, version.text))
							: null,
					];
				}),
			),
		[versions],
	);
	return (
		<ol aria-label="Versions" className="ml-6 flex flex-col gap-0.5 pb-1">
			{[...versions].reverse().map((version, index) => {
				const isShown = version === shown;
				return (
					<li key={version.version}>
						<FluidListItem<HTMLButtonElement> index={10_000 + index}>
							{(item) => (
								<button
									type="button"
									ref={item.ref}
									aria-current={isShown || undefined}
									onClick={() => pick(version.version)}
									onFocus={item.onFocus}
									className={cn(
										"relative flex w-full items-baseline gap-1.5 rounded-md py-1 pr-2.5 pl-3 text-left text-[11px] tabular-nums outline-none transition-colors corner-squircle squircle:rounded-xl",
										isShown && "bg-muted",
									)}
								>
									<span
										className={cn(
											"shrink-0",
											isShown ? "text-foreground" : "text-foreground/80",
										)}
									>
										v{numbers.get(version.version)}
									</span>
									<VersionChange
										change={changes.get(version.version) ?? null}
									/>
									<span className="ml-auto shrink-0 text-muted-foreground">
										{version.sessions}{" "}
										{version.sessions === 1 ? "session" : "sessions"}
									</span>
								</button>
							)}
						</FluidListItem>
					</li>
				);
			})}
		</ol>
	);
}

function VersionChange({
	change,
}: {
	change: { added: number; removed: number } | null;
}) {
	if (!change) return null;
	return (
		<span
			className="shrink-0 tabular-nums"
			title="Lines added and removed since the version before"
		>
			<span className="text-emerald-600 dark:text-emerald-400">
				+{change.added}
			</span>{" "}
			<span className="text-rose-600 dark:text-rose-400">
				−{change.removed}
			</span>
		</span>
	);
}

function RepoSetupRow({
	file,
	index,
	isPicked,
	meta,
	muted = false,
	onPick,
	root = null,
	showHome,
}: {
	file: RepositorySetupFile;
	root?: string | null;
	meta?: string | null;
	muted?: boolean;
	index: number;
	isPicked: boolean;
	onPick: (setupFile: string) => void;
	showHome: boolean;
}) {
	const owner =
		file.scope === "repository"
			? showHome
				? "Repo"
				: null
			: file.scope === "member"
				? showHome
					? "Root"
					: null
				: file.scope === LISTED_SCOPE
					? null
					: setupOwner(file);
	const item = useFluidListItem<HTMLButtonElement>(index);
	const name = (
		<span
			title={file.setupFile}
			className={cn(
				"truncate text-xs",
				isPicked ? "text-foreground" : "text-foreground/90",
			)}
		>
			{setupName(file)}
		</span>
	);
	return (
		<button
			type="button"
			ref={item.ref}
			aria-current={isPicked || undefined}
			onClick={() => onPick(file.setupFile)}
			onFocus={item.onFocus}
			className={cn(
				"relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors corner-squircle squircle:rounded-xl",
				isPicked && "bg-muted",
			)}
		>
			<span
				className={cn("flex shrink-0", muted && "opacity-60 grayscale")}
				title={
					muted
						? file.kind === "skill_body"
							? "Loaded, never called"
							: "Connected, never called"
						: undefined
				}
			>
				<SetupMark file={file} />
			</span>
			<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
				{name}
				{file.scope !== "mcp" && owner ? (
					<span className="shrink-0 text-[11px] text-muted-foreground">
						{owner}
					</span>
				) : null}
				{root ? (
					<span className="shrink-0 text-[11px] text-muted-foreground">
						{root}
					</span>
				) : null}
				{meta !== undefined ? (
					meta ? (
						<span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
							{meta}
						</span>
					) : null
				) : file.versions > 1 ? (
					<span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
						{file.versions} versions
					</span>
				) : null}
			</span>
		</button>
	);
}

function repeatedSetupNames(files: readonly { kind: string; path: string }[]) {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const file of files) {
		const name = setupName(file as RepositorySetupFile);
		if (seen.has(name)) repeated.add(name);
		seen.add(name);
	}
	return repeated;
}

function setupRoot(file: { path: string }) {
	return /^(~\/)?\.[^/]+/u.exec(file.path)?.[0] ?? null;
}

const LIST_SKELETON = [62, 48, 70, 54, 40, 66, 58, 44, 72, 50, 60, 46, 68, 52];
const RAIL_SKELETON = [64, 56, 70, 60, 52, 66, 58, 62, 54, 68];
const CARD_SKELETON = [88, 72, 80, 56, 76, 64, 84, 48];

function SetupSkeleton() {
	return (
		<div
			className="h-full overflow-hidden pt-2 pr-8 pb-2 pl-6"
			aria-hidden="true"
		>
			<div className="flex h-full min-h-0 gap-6">
				<div className="-mb-2 flex min-h-0 w-[320px] shrink-0 flex-col gap-1.5">
					<div className="flex h-8 shrink-0 items-center rounded-md bg-muted/50 pl-2">
						<Bar className="h-2.5 w-20 rounded-full" />
					</div>
					<div className="flex flex-col gap-0.5">
						{LIST_SKELETON.map((width, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder list
								key={index}
								className="flex h-7 items-center gap-2.5 px-2.5"
							>
								<Bar className="size-4 shrink-0 rounded-full" />
								<Bar
									className="h-2.5 rounded-full"
									style={{ width: `${width}%` }}
								/>
							</div>
						))}
					</div>
				</div>
				<div className={RUNS_SHELF}>
					<div className={cn(RAIL_SHELF, "w-[120px] px-3.5 pt-3")}>
						{RAIL_SKELETON.map((width, index) => (
							<Bar
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder list
								key={index}
								className="my-2 h-2.5 rounded-full"
								style={{ width: `${width}%` }}
							/>
						))}
					</div>
					<div
						className={cn(
							"relative z-10 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4",
							CARD,
						)}
					>
						<div className="flex items-center gap-2 pb-3">
							<Bar className="size-4 shrink-0 rounded-full" />
							<Bar className="h-3 w-40 rounded-full" />
						</div>
						{CARD_SKELETON.map((width, index) => (
							<Bar
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder list
								key={index}
								className="h-2.5 rounded-full"
								style={{ width: `${width}%` }}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
