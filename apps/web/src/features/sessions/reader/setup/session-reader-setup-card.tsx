import type { SessionSetupFile } from "@rudel/api-routes";
import { useMemo, useState } from "react";
import { Button } from "@/app/ui/button";
import { Skeleton } from "@/app/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSessionSetupText } from "../../use-session-setup-text";
import { ScrollColumn, TOGGLE } from "../files/session-reader-files-parts";
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
	file,
	versions: { pick, query, shown, versions },
}: {
	file: SessionSetupFile;
	versions: SetupVersions;
}) {
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
					<span className="shrink-0 text-xs text-muted-foreground">
						{setupOwner(file)} · {KIND_LABEL[file.kind] ?? file.kind}
					</span>
				</div>
				{versions.length > 0 && versions.length < file.versions ? (
					<p className="text-xs text-muted-foreground tabular-nums">
						The latest {versions.length} of its {file.versions} versions.
					</p>
				) : null}
				{versions.length > 1 ? (
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
						<div className="flex flex-col gap-2 px-5 py-4">
							{[88, 72, 80, 56, 64].map((width) => (
								<Skeleton
									key={width}
									className="h-3.5 rounded-md"
									style={{ width: `${width}%` }}
								/>
							))}
						</div>
					) : !shown ? (
						<p className="px-5 py-4 text-[13px] text-muted-foreground">
							{query.isError
								? "Its text could not be read."
								: "Its text was not kept for this session."}
						</p>
					) : (
						<ScrollColumn className="px-5 py-4">
							<SetupProse text={shown.text} />
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
