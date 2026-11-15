import { Menu } from "@base-ui/react/menu";
import type {
	HistoricalSkillDetail,
	HistoricalSkillVersion,
} from "@rudel/api-routes";
import { IconCheck, IconChevronDown, IconStack2 } from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import { Bone, Reveal } from "@/app/ui/bones";
import { Button } from "@/app/ui/button";
import { getToolPresentation } from "@/components/conversation/conversation-tools";
import { ConversationTraceTag } from "@/components/conversation/conversation-trace-tag";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { SESSION_OVERVIEW_MENU_TRIGGER_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { CopyButton } from "@/features/shell/components/copy-button";
import { RichSkillDocument } from "@/features/skills/components/rich-skill-document";
import {
	getDistinctSkillVersions,
	getSkillAllowedTools,
} from "@/features/skills/skill-document-content";
import { formatFullDateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import "@/features/sessions/components/session-menu.css";

export function HistoricalSkillDetailContent({
	detail,
	isError,
	isPending,
	previewContent,
	onRetry,
	variant = "pane",
}: {
	detail: HistoricalSkillDetail | undefined;
	isError: boolean;
	isPending: boolean;
	previewContent: string | null;
	onRetry: () => void;
	/** `pane` fills a split pane under a ruled toolbar; `card` sits in a
	 * floating card, as the session reader's inspector does. */
	variant?: "pane" | "card";
}) {
	const [selectedVersionKey, setSelectedVersionKey] = useState<string | null>(
		null,
	);
	const [raw, setRaw] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const versions = useMemo(
		() => getDistinctSkillVersions(detail?.versions ?? []),
		[detail?.versions],
	);
	const selectedVersion =
		versions.find((version) => getVersionKey(version) === selectedVersionKey) ??
		versions[0];
	const allowedTools = selectedVersion
		? getSkillAllowedTools(selectedVersion.content)
		: [];

	return (
		<>
			<div
				className={cn(
					"flex shrink-0 items-center gap-3",
					variant === "card"
						? "px-5 pt-5 pb-1"
						: "h-12 border-b border-(--session-overview-border) px-6",
				)}
				data-slot="skill-version-toolbar"
			>
				{isPending || (detail && selectedVersion) ? (
					<Reveal
						label="Loading skill versions"
						loading={isPending}
						sample={<Bone className="h-7 w-28 rounded-md" />}
						sampleId="skill-versions"
					>
						{() =>
							selectedVersion ? (
								<SkillVersionMenu
									versions={versions}
									selectedVersion={selectedVersion}
									onSelect={(key) => {
										setSelectedVersionKey(key);
										if (scrollRef.current) scrollRef.current.scrollTop = 0;
									}}
								/>
							) : null
						}
					</Reveal>
				) : null}
				{/* Rendered is the readable document; Raw is the file as written. */}
				{selectedVersion ? (
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{raw ? (
							<CopyButton
								value={selectedVersion.content}
								title="Copy skill file"
							/>
						) : null}
						<Button
							type="button"
							size="xs"
							variant="ghost"
							aria-pressed={raw}
							className="text-muted-foreground/60 hover:text-foreground"
							onClick={() => setRaw((value) => !value)}
						>
							{raw ? "Rendered" : "Raw"}
						</Button>
					</div>
				) : null}
			</div>
			<div
				ref={scrollRef}
				data-slot="skill-content-scroll"
				className={cn(
					"min-h-0 flex-1 overflow-y-auto overscroll-none",
					variant === "card" ? "p-5" : "p-5 sm:p-7",
				)}
			>
				{isPending && previewContent ? (
					<SkillDetailPreview previewContent={previewContent} />
				) : !isPending && (isError || !detail) ? (
					<div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
						<h3 className="text-base font-medium">
							Skill details couldn’t load
						</h3>
						<Button type="button" variant="outline" onClick={onRetry}>
							Try again
						</Button>
					</div>
				) : (
					<Reveal
						label="Loading skill details"
						loading={isPending}
						sample={<SkillDetailSample />}
						sampleId="skill-detail"
					>
						{() =>
							selectedVersion && raw ? (
								// No scroll box of its own: the pane is the one scroll area.
								<pre className="rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
									{selectedVersion.content}
								</pre>
							) : selectedVersion ? (
								<>
									{allowedTools.length > 0 ? (
										<div className="mb-6 flex flex-wrap items-center gap-2">
											<span className="text-[0.8125rem] font-medium text-(--session-overview-muted)">
												Allowed tools
											</span>
											<ul
												aria-label="Allowed tools"
												className="m-0 flex min-w-0 flex-wrap list-none items-center gap-1 p-0"
											>
												{allowedTools.map((tool) => (
													<li key={tool} className="flex shrink-0">
														<ConversationTraceTag
															toolIcon={
																getToolPresentation(tool.split("(")[0] ?? tool)
																	.icon
															}
															value={tool}
															title={`Allowed tool: ${tool}`}
															className="shrink-0"
														>
															<span className="font-sans">{tool}</span>
														</ConversationTraceTag>
													</li>
												))}
											</ul>
										</div>
									) : null}
									<RichSkillDocument
										content={selectedVersion.content}
										className="min-w-0"
									/>
								</>
							) : (
								<div className="py-10 text-center text-sm text-(--session-overview-muted)">
									No complete content was recovered
								</div>
							)
						}
					</Reveal>
				)}
			</div>
		</>
	);
}

function SkillVersionMenu({
	versions,
	selectedVersion,
	onSelect,
}: {
	versions: HistoricalSkillVersion[];
	selectedVersion: HistoricalSkillVersion;
	onSelect: (key: string) => void;
}) {
	const label = `Version ${versions.length - versions.indexOf(selectedVersion)}`;
	return (
		<Menu.Root>
			<Menu.Trigger
				aria-label={`Skill version, ${label}`}
				className={SESSION_OVERVIEW_MENU_TRIGGER_CLASS_NAME}
			>
				<IconStack2
					aria-hidden="true"
					className="size-4 h-lh shrink-0 text-[#5d5d5d] dark:text-[#acaeb2]"
				/>
				<span>{label}</span>
				<IconChevronDown
					stroke={1.75}
					aria-hidden="true"
					className="size-4 shrink-0 text-[#5d5d5d] dark:text-[#acaeb2]"
				/>
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner align="start" sideOffset={6} className="z-50">
					<Menu.Popup
						aria-label="Skill versions"
						data-fluid-menu-root=""
						className="session-menu-surface session-menu-sort"
					>
						<FluidMenuHover />
						<Menu.RadioGroup
							aria-label="Version"
							value={getVersionKey(selectedVersion)}
							onValueChange={(value: unknown) => {
								if (typeof value === "string") onSelect(value);
							}}
						>
							{versions.map((version, index) => (
								<Menu.RadioItem
									key={getVersionKey(version)}
									value={getVersionKey(version)}
									closeOnClick
									className="session-menu-row"
									title={`Last used ${formatFullDateLabel(version.lastUsedAt)}`}
								>
									<Menu.RadioItemIndicator className="session-menu-sort-check">
										<IconCheck aria-hidden="true" className="size-3.5" />
									</Menu.RadioItemIndicator>
									Version {versions.length - index}
								</Menu.RadioItem>
							))}
						</Menu.RadioGroup>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

function SkillDetailPreview({ previewContent }: { previewContent: string }) {
	return (
		<div aria-busy="true" className="space-y-3">
			<output className="sr-only">Loading skill details</output>
			<RichSkillDocument content={previewContent} />
		</div>
	);
}

function SkillDetailSample() {
	return (
		<div className="space-y-3">
			<Bone className="h-6 w-52 rounded-2xl" />
			<Bone className="h-4 w-full rounded-2xl" />
			<Bone className="h-4 w-[88%] rounded-2xl" />
			<Bone className="h-4 w-[72%] rounded-2xl" />
		</div>
	);
}

function getVersionKey(version: HistoricalSkillVersion): string {
	return `${version.sourceAgent}:${version.contentSha256}`;
}
