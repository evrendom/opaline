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
import { RetryButton } from "@/components/retry-button";
import { SessionMenuPopup } from "@/features/sessions/components/session-menu-popup";
import { CopyButton } from "@/features/shell/components/copy-button";
import { RichSkillDocument } from "@/features/skills/components/rich-skill-document";
import {
	getDistinctSkillVersions,
	getSkillAllowedTools,
} from "@/features/skills/skill-document-content";
import { formatFullDateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

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
					"flex shrink-0 items-center gap-l",
					variant === "card"
						? "px-xxl pt-xxl pb-xs"
						: "h-12 edge-b-m border-line-strong px-xxl",
				)}
				data-slot="skill-version-toolbar"
			>
				{isPending || (detail && selectedVersion) ? (
					<Reveal
						label="Loading skill versions"
						loading={isPending}
						sample={<Bone className="h-7 w-28 corner-s" />}
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
					<div className="ml-auto flex shrink-0 items-center gap-xs">
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
							className="text-ink-3/60 hover:text-ink"
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
					variant === "card"
						? "p-xxl"
						: "p-xxl sm:p-[calc(var(--space-xxl)*1.25)]",
				)}
			>
				{isPending && previewContent ? (
					<SkillDetailPreview previewContent={previewContent} />
				) : !isPending && (isError || !detail) ? (
					<div className="flex min-h-56 flex-col items-center justify-center gap-l text-center">
						<h3 className="text-body-xxl font-medium">
							Skill details couldn’t load
						</h3>
						<RetryButton onRetry={onRetry} />
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
								<pre className="corner-s bg-field p-l font-data text-body-m whitespace-pre-wrap [overflow-wrap:anywhere]">
									{selectedVersion.content}
								</pre>
							) : selectedVersion ? (
								<>
									{allowedTools.length > 0 ? (
										<div className="mb-xxl flex flex-wrap items-center gap-m">
											<span className="text-body-l font-medium text-ink-3">
												Allowed tools
											</span>
											<ul
												aria-label="Allowed tools"
												className={cn(
													"flex min-w-0 flex-wrap items-center gap-xs",
													"m-zero p-zero",
													"list-none",
												)}
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
															<span className="font-body">{tool}</span>
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
								<div className="py-[calc(var(--space-xxl)*5/3)] text-center text-body-xl text-ink-3">
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
				render={<Button variant="toolbar" />}
			>
				<IconStack2
					aria-hidden="true"
					className="size-4 h-lh shrink-0 text-ink-2 dark:text-ink-3"
				/>
				<span>{label}</span>
				<IconChevronDown
					stroke={1.75}
					aria-hidden="true"
					className="size-4 shrink-0 text-ink-2 dark:text-ink-3"
				/>
			</Menu.Trigger>
			<SessionMenuPopup aria-label="Skill versions">
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
							className="menu-row"
							title={`Last used ${formatFullDateLabel(version.lastUsedAt)}`}
						>
							<Menu.RadioItemIndicator className="menu-sort-check">
								<IconCheck aria-hidden="true" className="size-3.5" />
							</Menu.RadioItemIndicator>
							Version {versions.length - index}
						</Menu.RadioItem>
					))}
				</Menu.RadioGroup>
			</SessionMenuPopup>
		</Menu.Root>
	);
}

function SkillDetailPreview({ previewContent }: { previewContent: string }) {
	return (
		<div aria-busy="true" className="space-y-l">
			<output className="sr-only">Loading skill details</output>
			<RichSkillDocument content={previewContent} />
		</div>
	);
}

function SkillDetailSample() {
	return (
		<div className="space-y-l">
			<Bone className="h-6 w-52 corner-xl" />
			<Bone className="h-4 w-full corner-xl" />
			<Bone className="h-4 w-[88%] corner-xl" />
			<Bone className="h-4 w-[72%] corner-xl" />
		</div>
	);
}

function getVersionKey(version: HistoricalSkillVersion): string {
	return `${version.sourceAgent}:${version.contentSha256}`;
}
