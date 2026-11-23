import type {
	RepositoryFile,
	RepositoryFiles,
	RepositoryRunsOf,
} from "@rudel/api-routes";
import {
	IconAlertTriangle,
	IconBrandGithub,
	IconFile,
	IconFileCode,
	IconLock,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { Reveal } from "@/app/ui/bones";
import { Button } from "@/app/ui/button";
import { Skeleton } from "@/app/ui/skeleton";
import { EmptyState } from "@/components/dashboard/page-parts";
import { CodeSample, CodeSkeleton } from "@/components/pierre/code-skeleton";
import { DiffView, languageForPath } from "@/components/pierre/diff-view";
import { FileTree } from "@/components/pierre/file-tree";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { wholeText } from "@/features/sessions/reader/files/session-files-model";
import {
	CARD,
	Crumb,
	ReaderPane,
	ReaderPaneHeader,
	ReaderPaneScroll,
	ScrollColumn,
	ViewToggle,
} from "@/features/sessions/reader/files/session-reader-files-parts";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import {
	matchRepoFileActivity,
	type RepoFilesKept,
	repoTreeItems,
} from "./repo-file-activity";
import { useRepoRangeInput } from "./repo-reader/repo-page-data";
import { RunCallCard } from "./repo-reader/repo-run-calls";
import {
	RepoRunsColumn,
	RUNS_SHELF,
	runKeyOf,
	usePickedRun,
} from "./repo-reader/repo-runs-column";

const FILE_PARAM = "file";
const STALE_TIME_MS = 5 * 60_000;
type AvailableFiles = Extract<RepositoryFiles, { status: "available" }>;

export function RepoFiles({ repoKey }: { repoKey: string }) {
	const range = useRepoRangeInput();
	const tree = useAnalyticsQuery({
		...orpc.analytics.repositories.files.queryOptions({ input: { repoKey } }),
		staleTime: STALE_TIME_MS,
	});
	const activity = useAnalyticsQuery({
		...orpc.analytics.repositories.fileActivity.queryOptions({
			input: { repoKey, range },
		}),
		staleTime: STALE_TIME_MS,
	});
	const [searchParams, setSearchParams] = useSearchParams();
	const [kept, setKept] = useState<RepoFilesKept>("all");
	const entries = tree.data?.status === "available" ? tree.data.entries : null;
	const paths = activity.data?.paths;
	const files = useMemo(
		() => (entries && paths ? matchRepoFileActivity(entries, paths) : null),
		[entries, paths],
	);
	const items = useMemo(
		() => (files ? repoTreeItems(files, kept) : []),
		[files, kept],
	);
	const picked = searchParams.get(FILE_PARAM);
	const pickedPaths = picked ? files?.get(picked)?.paths : undefined;
	const runsOf: RepositoryRunsOf | null = pickedPaths
		? { kind: "file", paths: [...pickedPaths] }
		: null;
	const [pickedRun, pickRun] = usePickedRun();
	const pick = (path: string | null) =>
		setSearchParams(
			(params) => {
				if (path) params.set(FILE_PARAM, path);
				else params.delete(FILE_PARAM);
				params.delete("pickedRun");
				params.delete("pickedCall");
				return params;
			},
			{ replace: true },
		);

	if (tree.data?.status === "unavailable")
		return <FilesUnavailable reason={tree.data.reason} />;
	if (tree.isError || activity.isError)
		return (
			<FilesPane>
				<EmptyState
					icon={IconAlertTriangle}
					title="The files could not be read"
					description="Reading this repo's files failed. Try the tab again in a moment."
				/>
			</FilesPane>
		);
	if (files && files.size === 0)
		return (
			<FilesPane>
				<EmptyState
					icon={IconFileCode}
					title="No files"
					description="This repo's sessions wrote, edited or read no file in it."
				/>
			</FilesPane>
		);
	return (
		<FilesPane>
			<div className="flex h-full min-h-0 gap-xxl">
				<div className="-mb-m flex min-h-0 w-[320px] shrink-0 flex-col gap-s">
					<div
						className={cn(
							"flex h-8 shrink-0 items-center gap-s",
							"corner-s pr-xs pl-m",
							"text-body-m",
							"bg-hover",
						)}
					>
						<span className="shrink-0 font-medium">Entire repo</span>
						<span className="ml-auto">
							<ViewToggle
								label="Which files to list"
								onPick={setKept}
								options={[
									{ id: "changed", label: "Changed" },
									{ id: "read", label: "Read" },
									{ id: "all", label: "All" },
								]}
								value={kept}
							/>
						</span>
					</div>
					<div className="-mx-xs flex min-h-0 flex-1 flex-col">
						<ScrollColumn className="px-xs pb-[calc(var(--space-xxl)*4/3)]">
							{files ? (
								<FileTree items={items} onSelect={pick} selected={picked} />
							) : (
								<TreeSkeleton />
							)}
						</ScrollColumn>
					</div>
				</div>
				<div className={RUNS_SHELF}>
					<RepoRunsColumn
						empty="No run touched it"
						label="Runs"
						of={runsOf}
						repoKey={repoKey}
						scope={
							picked && runsOf
								? {
										name: picked.split("/").at(-1) ?? picked,
										onClear: () => pick(null),
									}
								: undefined
						}
					/>
					<div
						className={cn(
							"relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden",
							CARD,
						)}
					>
						<RunCallCard
							file={
								picked && tree.data?.status === "available"
									? {
											path: picked,
											commitSha: tree.data.repository.commitSha,
										}
									: undefined
							}
							of={runsOf}
							onClear={() => pickRun(null)}
							picked={pickedRun}
							repoKey={repoKey}
							runKeyOf={runKeyOf}
							sessionTab="files"
						>
							{picked && tree.data?.status === "available" && files ? (
								files.has(picked) ? (
									<RepoFileDetail
										key={`${tree.data.repository.commitSha}:${picked}`}
										path={picked}
										repoKey={repoKey}
										repository={tree.data.repository}
									/>
								) : (
									<p className="px-[calc(var(--space-xl)+var(--space-xs))] py-xl text-body-l text-ink-3">
										<span className="font-data">{picked}</span> isn't among the
										files this repo's sessions changed or read.
									</p>
								)
							) : picked && !files ? (
								<FileDetailSkeleton />
							) : (
								<div className="flex min-w-0 flex-1 flex-col p-xl">
									<EmptyState
										icon={IconFile}
										title="Pick a file"
										description="Pick a file on the left to see it as it is on the default branch."
									/>
								</div>
							)}
						</RunCallCard>
					</div>
				</div>
			</div>
		</FilesPane>
	);
}

function FilesPane({ children }: { children: React.ReactNode }) {
	return (
		<div className="h-full overflow-hidden pt-m pr-[calc(var(--space-xxl)*4/3)] pb-m pl-xxl">
			{children}
		</div>
	);
}

function FilesUnavailable({
	reason,
}: {
	reason: Extract<RepositoryFiles, { status: "unavailable" }>["reason"];
}) {
	const getShellRoutePath = useShellRoutePath();
	if (reason === "not-connected")
		return (
			<FilesPane>
				<EmptyState
					icon={IconBrandGithub}
					title="Connect this repo on GitHub to browse its files"
					description="Opaline reads files from GitHub when you open them and never stores them."
				>
					<Button
						variant="primary"
						className="mx-auto mt-m"
						render={<Link to={getShellRoutePath(appRoutes.settingsGitHub())} />}
					>
						<IconBrandGithub />
						GitHub settings
					</Button>
				</EmptyState>
			</FilesPane>
		);
	return (
		<FilesPane>
			<EmptyState
				icon={IconFileCode}
				title={
					reason === "not-github"
						? "This repo isn’t on GitHub"
						: "GitHub didn’t return this repo’s files"
				}
				description={
					reason === "not-github"
						? "Files are read from GitHub, and this repo’s sessions carry no GitHub remote."
						: "It may have been removed from the Opaline GitHub App, or have no commits yet."
				}
			/>
		</FilesPane>
	);
}

function RepoFileDetail({
	path,
	repoKey,
	repository,
}: {
	path: string;
	repoKey: string;
	repository: AvailableFiles["repository"];
}) {
	const query = useAnalyticsQuery({
		...orpc.analytics.repositories.file.queryOptions({
			input: { repoKey, path, commitSha: repository.commitSha },
		}),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const name = path.split("/").at(-1) ?? path;
	const directory = path.slice(0, path.length - name.length);
	const file = query.data;
	const hunks = useMemo(
		() => (file?.status === "text" ? wholeText(file.content) : null),
		[file],
	);
	const githubUrl = `https://github.com/${repository.owner}/${repository.name}/blob/${repository.commitSha}/${path
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;
	return (
		<ReaderPane>
			<ReaderPaneHeader crumbs={<Crumb title={path}>{name}</Crumb>}>
				<a
					href={githubUrl}
					target="_blank"
					rel="noreferrer"
					title="View on GitHub"
					className={cn(
						"inline-flex h-6 items-center gap-xs",
						"corner-s px-m",
						"text-body-m font-medium",
						"text-ink-3 transition-colors",
						"hover:text-ink",
					)}
				>
					<IconBrandGithub aria-hidden="true" className="size-3.5" />
					{repository.commitSha.slice(0, 7)}
				</a>
			</ReaderPaneHeader>
			<span
				className={cn(
					"shrink-0 [direction:rtl]",
					"-mt-xs pl-m",
					"truncate text-left text-body-m",
					"text-ink-3",
				)}
				title={directory}
			>
				{`‎${directory}‎`}
			</span>
			{query.isError ? (
				<EmptyState
					icon={IconAlertTriangle}
					title="The file could not be read"
					description="Reading it from GitHub failed. Pick it again in a moment."
					className="mt-l"
				/>
			) : !file || hunks ? (
				<ReaderPaneScroll>
					<div className="flex flex-col gap-m pt-m pb-xl">
						<Reveal
							label="Loading the file"
							loading={!file}
							sample={<CodeSample />}
							sampleId="repo-file"
						>
							{() =>
								hunks ? (
									<DiffView hunks={hunks} language={languageForPath(path)} />
								) : null
							}
						</Reveal>
					</div>
				</ReaderPaneScroll>
			) : file.status !== "text" ? (
				<FileNotShown file={file} />
			) : null}
		</ReaderPane>
	);
}

function FileNotShown({
	file,
}: {
	file: Exclude<RepositoryFile, { status: "text" }>;
}) {
	const copy = {
		binary: {
			icon: IconFileCode,
			title: "Binary file",
			description: "Only text files are shown. Open it on GitHub instead.",
		},
		"too-large": {
			icon: IconFileCode,
			title: "Too large to show",
			description: "Files up to 512 KB are shown. Open it on GitHub instead.",
		},
		withheld: {
			icon: IconLock,
			title: "Credential files aren’t shown",
			description:
				"Files like .env and private keys are never read from GitHub.",
		},
		unavailable: {
			icon: IconAlertTriangle,
			title: "GitHub didn’t return this file",
			description: "It may have been moved or deleted on the default branch.",
		},
	}[file.status];
	return (
		<EmptyState
			icon={copy.icon}
			title={copy.title}
			description={copy.description}
			className="mt-l"
		/>
	);
}

const TREE_SKELETON: readonly [depth: number, width: number][] = [
	[0, 44],
	[1, 38],
	[1, 52],
	[2, 64],
	[0, 30],
	[1, 46],
	[2, 58],
	[2, 70],
	[3, 62],
	[3, 48],
	[2, 54],
	[1, 40],
	[0, 34],
	[1, 50],
	[2, 66],
	[2, 44],
	[3, 72],
	[3, 56],
	[1, 42],
	[0, 28],
	[1, 60],
	[1, 36],
	[2, 50],
	[2, 68],
	[0, 46],
	[1, 54],
	[2, 62],
	[3, 58],
	[3, 44],
	[1, 48],
	[0, 38],
	[0, 52],
	[1, 44],
	[2, 60],
	[2, 50],
	[1, 36],
	[0, 42],
	[1, 56],
	[1, 46],
	[0, 32],
];

function TreeSkeleton() {
	return (
		<div className="flex flex-col" aria-hidden="true">
			{TREE_SKELETON.map(([depth, width], index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder list
					key={index}
					className="flex h-7 shrink-0 items-center gap-m pr-[calc(var(--space-m)+var(--space-xxs))]"
					style={{ paddingLeft: 8 + depth * 12 }}
				>
					<Skeleton className="size-3.5 shrink-0 corner-xs" />
					<Skeleton
						className="h-2.5 corner-full"
						style={{ width: `${width}%` }}
					/>
				</div>
			))}
		</div>
	);
}

function FileDetailSkeleton() {
	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col gap-s pt-xl pr-xl pl-[calc(var(--space-xl)+var(--space-xs))]"
			aria-hidden="true"
		>
			<div className="flex min-h-7 items-center gap-l">
				<Skeleton className="h-5 w-40" />
				<Skeleton className="ml-auto h-4 w-32" />
			</div>
			<Skeleton className="h-3 w-56 shrink-0" />
			<ReaderPaneScroll>
				<div className="flex flex-col gap-m pt-m pb-xl">
					<CodeSkeleton label="Loading the file" />
				</div>
			</ReaderPaneScroll>
		</div>
	);
}
