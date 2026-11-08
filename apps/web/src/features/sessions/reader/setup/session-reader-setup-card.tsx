import type { SessionSetupFile } from "@rudel/api-routes";
import { IconCode, IconFileDiff } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Bone, Bones } from "@/app/ui/bones";
import { Button } from "@/app/ui/button";
import { DiffView } from "@/components/pierre/diff-view";
import { diffLines } from "@/components/pierre/line-diff";
import { cn } from "@/lib/utils";
import { useSessionSetupText } from "../../use-session-setup-text";
import {
	ScrollColumn,
	TOGGLE,
	ViewToggle,
} from "../files/session-reader-files-parts";
import { SetupMark } from "./session-reader-setup-column";
import { SetupProse } from "./session-reader-setup-prose";
import { KIND_LABEL, setupName, setupOwner } from "./session-setup-files";

export function useSetupVersions(sessionId: string, setupFile: string) {
	const query = useSessionSetupText(sessionId, setupFile);
	const [picked, setPicked] = useState<{
		file: string;
		version: string;
	} | null>(null);
	const versions = query.data?.versions ?? [];
	const shown =
		versions.find(
			(version) =>
				picked?.file === setupFile && version.version === picked.version,
		) ??
		versions.reduce<(typeof versions)[number] | undefined>(
			(most, version) => (!most || version.runs >= most.runs ? version : most),
			undefined,
		);
	const numbers = useMemo(
		() =>
			new Map(versions.map((version, index) => [version.version, index + 1])),
		[versions],
	);
	const pick = (version: string) => setPicked({ file: setupFile, version });
	return { numbers, pick, query, shown, versions };
}

export type SetupVersions = ReturnType<typeof useSetupVersions>;

export function SetupCard({
	details = true,
	diffs = false,
	file,
	versions: { pick, query, shown, versions },
	versionPicker = true,
}: {
	details?: boolean;
	diffs?: boolean;
	file: SessionSetupFile;
	versions: SetupVersions;
	versionPicker?: boolean;
}) {
	const [view, setView] = useState<"changes" | "file">("file");
	const previous = shown ? versions[versions.indexOf(shown) - 1] : undefined;
	const showDiff = diffs && view === "changes" && previous !== undefined;
	const hunks = useMemo(
		() =>
			showDiff && previous && shown
				? diffLines(previous.text, shown.text)
				: null,
		[previous, showDiff, shown],
	);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<header className="flex flex-col gap-2 border-b border-border/50 px-5 py-4">
				<div className="flex min-w-0 items-center gap-2">
					<span className="flex shrink-0">
						<SetupMark file={file} />
					</span>
					<h2
						title={file.setupFile}
						className="min-w-0 truncate text-sm font-medium"
					>
						{setupName(file)}
					</h2>
					{details ? (
						<span className="shrink-0 text-xs text-muted-foreground">
							{setupOwner(file)} · {KIND_LABEL[file.kind] ?? file.kind}
						</span>
					) : null}
					{diffs && versions.length > 1 ? (
						<span className="ml-auto">
							<ViewToggle
								iconsOnly
								label="The version's changes, or its text"
								onPick={setView}
								options={[
									{
										icon: IconFileDiff,
										id: "changes",
										label: "Changes",
										off: previous === undefined,
									},
									{ icon: IconCode, id: "file", label: "File" },
								]}
								value={showDiff ? "changes" : "file"}
							/>
						</span>
					) : null}
				</div>
				{details && versions.length > 0 && versions.length < file.versions ? (
					<p className="text-xs text-muted-foreground tabular-nums">
						The latest {versions.length} of its {file.versions} versions.
					</p>
				) : null}
				{versionPicker && versions.length > 1 ? (
					<div className="flex flex-wrap items-center gap-1">
						{versions.map((version, index) => (
							<Button
								key={version.version}
								size="xs"
								variant="ghost"
								className={cn("font-mono", TOGGLE)}
								aria-pressed={version === shown}
								title={`First received ${new Date(version.firstAt).toLocaleString()}, by ${version.runs} ${version.runs === 1 ? "run" : "runs"}`}
								onClick={() => pick(version.version)}
							>
								{index + 1}. {version.versionName}
							</Button>
						))}
					</div>
				) : null}
			</header>
			<div className="flex min-h-0 flex-1">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					{query.isLoading ? (
						<Bones label="Reading its text">
							<div className="flex flex-col gap-2 px-5 py-4">
								{[88, 72, 80, 56, 64].map((width) => (
									<Bone
										key={width}
										className="h-3.5 rounded-md"
										style={{ width: `${width}%` }}
									/>
								))}
							</div>
						</Bones>
					) : !shown ? (
						<p className="px-5 py-4 text-[13px] text-muted-foreground">
							{query.isError
								? "Its text could not be read."
								: "Its text was not kept for this session."}
						</p>
					) : (
						<ScrollColumn className="px-5 py-4">
							{hunks ? (
								hunks.length === 0 ? (
									<p className="text-[13px] text-muted-foreground">
										No line changed since the version before.
									</p>
								) : (
									<DiffView hunks={hunks} language="markdown" />
								)
							) : (
								<SetupProse text={shown.text} />
							)}
							{shown.textCut ? (
								<p className="pt-3 text-xs text-muted-foreground tabular-nums">
									Only its start was kept: the whole text is{" "}
									{shown.chars.toLocaleString()} characters.
								</p>
							) : null}
						</ScrollColumn>
					)}
				</div>
			</div>
		</div>
	);
}
