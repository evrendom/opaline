import type { SessionSetupFile } from "@rudel/api-routes";
import { IconListDetails, IconPlug, IconSettings } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Bones } from "@/app/ui/bones";
import { EmptyState } from "@/components/dashboard/page-parts";
import { FluidList, useFluidListItem } from "@/components/fluid-list";
import { formatPaddedTimeOfDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OpalChip } from "../detail/waterfall/session-reader-waterfall-chips";
import { getFileLanguage } from "../files/session-reader-file-tag";
import { ScrollColumn, ViewToggle } from "../files/session-reader-files-parts";
import { mcpTool } from "../model/session-reader-mcp-tool";
import type { SessionReaderStep } from "../model/session-reader-run-steps";
import { LANE_LOOK } from "../model/session-reader-step-lanes";
import { PickStrip } from "../rail/session-reader-pick-strip";
import { useColumnSlide } from "../rail/use-column-slide";
import type { RunSetupUses, SetupUse } from "./session-reader-setup-use";
import { setupGroups, setupName, setupOwner } from "./session-setup-files";

export type SetupColumnView = "setup" | "calls";

const VIEWS = [
	{ icon: IconSettings, id: "setup", label: "Setup" },
	{ icon: IconListDetails, id: "calls", label: "Calls" },
] as const;

export function SetupColumn({
	agent,
	model,
	onPick,
	onPickUse,
	onView,
	pickedUse,
	receivedBy,
	run,
	setup,
	shown,
	timeline,
	uses,
	view = "setup",
}: {
	agent: string | null;
	model: string | null;
	onPick: (setupFile: string) => void;
	onPickUse?: (use: SetupUse) => void;
	onView?: (view: SetupColumnView) => void;
	pickedUse?: string | null;
	receivedBy?: ReactNode;
	run: string | null;
	setup: readonly SessionSetupFile[];
	shown: SessionSetupFile | undefined;
	timeline?: ReactNode;
	uses?: RunSetupUses;
	view?: SetupColumnView;
}) {
	const calls = uses !== undefined && view === "calls";
	const files = setupGroups(setup)
		.flatMap((group) => group.files)
		.filter(
			(file) => !uses || (file.kind !== "skill_body" && file.scope !== "mcp"),
		);
	const count = uses ? uses.uses.length : setup.length;
	const column = useColumnSlide<HTMLDivElement>();
	const useGroups = uses ? groupUses(uses.uses) : [];
	const useIndex = new Map(
		useGroups
			.flatMap((group) => group.tools.flatMap((tool) => tool.uses))
			.map((use, index) => [use.step.id, index]),
	);
	return (
		<div
			className={cn(
				"-mb-2 flex min-h-0 min-w-(--reader-setup-column) flex-1 flex-col gap-1.5 pt-(--panes-top)",
			)}
		>
			<PickStrip
				agent={agent}
				model={model}
				run={run}
				summary={
					uses?.status === "loading"
						? undefined
						: uses
							? `${count} skill and MCP ${count === 1 ? "use" : "uses"}`
							: `${count} ${count === 1 ? "file" : "files"}`
				}
			>
				{uses ? (
					<ViewToggle
						label="The run's setup, or its calls"
						onPick={(next) =>
							column.slide(next === "calls", () => onView?.(next))
						}
						options={VIEWS}
						value={view}
					/>
				) : null}
			</PickStrip>
			<div ref={column.ref} className="-mx-1 flex min-h-0 flex-1 flex-col">
				<ScrollColumn className="px-1 pb-8">
					{calls ? timeline : null}
					{calls ? null : uses ? (
						<FluidList className="flex flex-col gap-0.5">
							{uses.status === "loading" ? (
								<UsesSkeleton />
							) : uses.status === "failed" ? (
								<p className="py-1 pl-2 text-[11px] text-muted-foreground">
									This run could not be read.
								</p>
							) : uses.uses.length === 0 ? (
								<EmptyState
									icon={IconPlug}
									title="No skills or MCP"
									description="This run used no skill or MCP server."
									className="mt-1 p-6 py-8"
								/>
							) : null}
							{useGroups.map((group) => (
								<SetupUseGroup
									key={group.file.setupFile}
									group={group}
									indexOf={(use) => useIndex.get(use.step.id)}
									onPickUse={(use) => onPickUse?.(use)}
									pickedUse={pickedUse ?? null}
								/>
							))}
						</FluidList>
					) : null}
					<FluidList
						className={cn(
							"flex flex-col gap-0.5",
							uses && "mt-3 border-t border-border/50 pt-2",
							calls && "hidden",
						)}
					>
						{files.length === 0 && !uses ? (
							<p className="py-1 pl-2 text-[11px] text-muted-foreground">
								No setup received in this run.
							</p>
						) : null}
						{files.map((file, index) => (
							<SetupFileRow
								key={file.setupFile}
								file={file}
								index={index}
								isPicked={file === shown && !pickedUse}
								onPick={onPick}
							/>
						))}
					</FluidList>
					{receivedBy ? (
						<div className="mt-3 border-t border-border/50 pt-1">
							{receivedBy}
						</div>
					) : null}
				</ScrollColumn>
			</div>
		</div>
	);
}

type UseGroup = {
	file: SessionSetupFile;
	tools: { tool: string | null; uses: SetupUse[] }[];
};

function groupUses(uses: readonly SetupUse[]): UseGroup[] {
	const groups = new Map<string, UseGroup>();
	for (const use of uses) {
		const group = groups.get(use.file.setupFile) ?? {
			file: use.file,
			tools: [],
		};
		groups.set(use.file.setupFile, group);
		const tool = use.step.toolEvent
			? (mcpTool(use.step.toolEvent.toolName)?.tool ?? null)
			: null;
		const inTool = group.tools.find((each) => each.tool === tool);
		if (inTool) inTool.uses.push(use);
		else group.tools.push({ tool, uses: [use] });
	}
	return [...groups.values()];
}

const countOf = (uses: number) => (
	<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
		{uses}×
	</span>
);

const SAMPLE_SERVER: SessionSetupFile = {
	chars: 0,
	firstAt: "2026-11-06T09:00:00.000Z",
	kind: "mcp_instructions",
	owner: "claude.ai Claude Docs",
	path: "",
	runs: 1,
	scope: "mcp",
	setupFile: "mcp:claude.ai Claude Docs",
	subagents: false,
	versions: 1,
};

function sampleUse(
	id: string,
	startMs: number,
	tool: string,
	input: Record<string, unknown>,
): SetupUse {
	return {
		file: SAMPLE_SERVER,
		step: {
			id,
			startMs,
			toolEvent: {
				id,
				input,
				kind: "tool",
				result: undefined,
				timestamp: new Date(startMs).toISOString(),
				toolName: `mcp__claude_ai_Claude_Docs__${tool}`,
			},
		} as SessionReaderStep,
	};
}

const SAMPLE_USE_GROUPS = groupUses([
	sampleUse("a", Date.UTC(2026, 10, 6, 9, 41, 12), "guide", {
		items: "topic.editing",
	}),
	sampleUse("b", Date.UTC(2026, 10, 6, 9, 41, 30), "guide", {
		items: "topic.charts",
	}),
	sampleUse("c", Date.UTC(2026, 10, 6, 9, 42, 5), "update", {
		title: "Retro digest notes",
	}),
	sampleUse("d", Date.UTC(2026, 10, 6, 9, 43, 51), "update", {
		title: "Section on the calls view",
	}),
]);

function UsesSkeleton() {
	return (
		<Bones label="Reading the run">
			{SAMPLE_USE_GROUPS.map((group) => (
				<SetupUseGroup
					key={group.file.setupFile}
					group={group}
					indexOf={() => undefined}
					onPickUse={() => {}}
					pickedUse={null}
				/>
			))}
		</Bones>
	);
}

function SetupUseGroup({
	group,
	indexOf,
	onPickUse,
	pickedUse,
}: {
	group: UseGroup;
	indexOf: (use: SetupUse) => number | undefined;
	onPickUse: (use: SetupUse) => void;
	pickedUse: string | null;
}) {
	const total = group.tools.reduce((sum, tool) => sum + tool.uses.length, 0);
	return (
		<div className="flex flex-col gap-0.5 pb-1.5">
			<div className="flex items-center gap-2.5 px-2.5 py-1.5">
				<span className="flex shrink-0">
					<SetupMark file={group.file} />
				</span>
				<span className="min-w-0 flex-1 truncate text-xs font-medium">
					{setupName(group.file)}
				</span>
				{countOf(total)}
			</div>
			{group.tools.map(({ tool, uses }) => (
				<div key={tool ?? ""} className="flex flex-col gap-0.5">
					{tool ? (
						<div className="flex items-center gap-2 py-1 pr-2.5 pl-9">
							<span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
								{tool}
							</span>
							{countOf(uses.length)}
						</div>
					) : null}
					{uses.map((use) => (
						<SetupUseRow
							key={use.step.id}
							indent={tool ? "pl-13" : "pl-9"}
							index={indexOf(use)}
							isPicked={use.step.id === pickedUse}
							onPick={() => onPickUse(use)}
							use={use}
						/>
					))}
				</div>
			))}
		</div>
	);
}

const ABOUT_KEYS = [
	"title",
	"question",
	"name",
	"query",
	"prompt",
	"path",
	"file_path",
	"url",
	"args",
];

function aboutOf(step: SessionReaderStep): string | null {
	const input = step.toolEvent?.input;
	const fields =
		input && typeof input === "object"
			? (input as Record<string, unknown>)
			: {};
	const named = ABOUT_KEYS.map((key) => fields[key]).find(
		(value): value is string =>
			typeof value === "string" && value.trim() !== "",
	);
	const text =
		named ??
		Object.values(fields).find(
			(value): value is string =>
				typeof value === "string" && value.trim() !== "",
		);
	const line = text?.trim().split("\n")[0]?.trim();
	if (!line) return null;
	const tool = step.toolEvent
		? mcpTool(step.toolEvent.toolName)?.tool
		: undefined;
	return line === tool ? null : line;
}

function SetupUseRow({
	indent,
	index,
	isPicked,
	onPick,
	use: { step },
}: {
	indent: string;
	index: number | undefined;
	isPicked: boolean;
	onPick: () => void;
	use: SetupUse;
}) {
	const about = aboutOf(step);
	const item = useFluidListItem<HTMLButtonElement>(index);
	return (
		<button
			type="button"
			ref={item.ref}
			aria-current={isPicked || undefined}
			onClick={onPick}
			onFocus={item.onFocus}
			className={cn(
				"relative flex w-full items-center gap-2.5 rounded-md py-1 pr-2.5 text-left outline-none transition-colors corner-squircle squircle:rounded-xl",
				indent,
				isPicked && "bg-muted",
			)}
		>
			<span
				className={cn(
					"shrink-0 text-[11px] tabular-nums",
					isPicked ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{formatPaddedTimeOfDay(step.startMs)}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-xs",
					isPicked ? "text-foreground" : "text-foreground/70",
				)}
			>
				{about}
			</span>
		</button>
	);
}

export function SetupMark({ file }: { file: SessionSetupFile }) {
	const look =
		file.kind === "skill_body"
			? LANE_LOOK.skill
			: file.scope === "mcp"
				? LANE_LOOK.tools
				: file.scope === "harness"
					? LANE_LOOK.context
					: null;
	if (!look) {
		const { Icon } = getFileLanguage(setupName(file));
		return (
			<span
				skullet-block=""
				className="inline-flex shrink-0 rounded-sm corner-squircle squircle:rounded-lg"
			>
				<Icon aria-hidden="true" className="size-4 text-muted-foreground/60" />
			</span>
		);
	}
	const Glyph = look.glyph;
	return (
		<OpalChip tint={look.tint} className="size-4 text-(--opal-tint)">
			<Glyph aria-hidden="true" className="size-2.5" />
		</OpalChip>
	);
}

function SetupFileRow({
	file,
	index,
	isPicked,
	onPick,
}: {
	file: SessionSetupFile;
	index: number;
	isPicked: boolean;
	onPick: (setupFile: string) => void;
}) {
	const item = useFluidListItem<HTMLButtonElement>(index);
	return (
		<button
			type="button"
			ref={item.ref}
			aria-current={isPicked || undefined}
			onClick={() => onPick(file.setupFile)}
			onFocus={item.onFocus}
			className={cn(
				"relative flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors corner-squircle squircle:rounded-xl",
				isPicked && "bg-muted",
			)}
		>
			<span className="mt-px flex shrink-0">
				<SetupMark file={file} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span
					title={file.setupFile}
					className={cn(
						"truncate text-xs",
						isPicked ? "text-foreground" : "text-foreground/90",
					)}
				>
					{setupName(file)}
				</span>
				<span className="truncate text-[11px] text-muted-foreground tabular-nums">
					{setupOwner(file)}
					{file.versions > 1 ? ` · ${file.versions} versions` : ""}
				</span>
			</span>
		</button>
	);
}
