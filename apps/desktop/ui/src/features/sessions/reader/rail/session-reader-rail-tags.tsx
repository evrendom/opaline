import { Menu } from "@base-ui/react/menu";
import type {
	SessionDetailTurnSummary,
	SessionTurnStepKind,
} from "@rudel/api-routes";
import { type Icon, IconAdjustmentsHorizontal } from "@tabler/icons-react";
import {
	type ComponentType,
	type CSSProperties,
	useCallback,
	useMemo,
	useState,
} from "react";
import { SessionMenuPopup } from "@/features/sessions/components/session-menu-popup";
import { cn } from "@/lib/utils";
import {
	OpalChip,
	Tip,
} from "../detail/waterfall/session-reader-waterfall-chips";
import { ViewToggle } from "../files/session-reader-files-parts";
import {
	type RunUiStore,
	useAllRunsFolded,
	useAllRunsOpen,
} from "../model/session-reader-run-ui-store";
import { LANE_LOOK } from "../model/session-reader-step-lanes";

type Glyph = ComponentType<{ className?: string; style?: CSSProperties }>;

type RailTag = {
	key: string;
	label: string;
	glyph: Glyph;
	tint: string;
	count: (turn: SessionDetailTurnSummary) => number;
};

const fileCount =
	(operation: "created" | "edited" | "read") =>
	(turn: SessionDetailTurnSummary) =>
		(turn.fileEvents ?? []).reduce(
			(total, event) =>
				event.operation === operation ? total + event.count : total,
			0,
		);

const STEP_KIND_TAGS = {
	git: { label: "Git", ...LANE_LOOK.git },
	github: { label: "GitHub", ...LANE_LOOK.ci },
	mcp: { label: "MCP tools", ...LANE_LOOK.tools },
	search: { label: "Searches", ...LANE_LOOK.search },
	shell: { label: "Shell", ...LANE_LOOK.shell },
	verify: { label: "Checks", ...LANE_LOOK.verify },
} satisfies Record<
	SessionTurnStepKind,
	Pick<RailTag, "glyph" | "label" | "tint">
>;

const stepTag = (kind: SessionTurnStepKind): RailTag => ({
	key: kind,
	...STEP_KIND_TAGS[kind],
	count: (turn) => turn.stepKinds?.[kind] ?? 0,
});

export const RAIL_TAGS: readonly RailTag[] = [
	stepTag("search"),
	{ key: "read", label: "Reads", ...LANE_LOOK.read, count: fileCount("read") },
	{
		key: "edit",
		label: "Edits",
		...LANE_LOOK.edit,
		count: fileCount("edited"),
	},
	{
		key: "write",
		label: "Writes",
		...LANE_LOOK.write,
		count: fileCount("created"),
	},
	{
		key: "skill",
		label: "Skills",
		...LANE_LOOK.skill,
		count: (turn) => turn.skillCount,
	},
	stepTag("verify"),
	stepTag("shell"),
	stepTag("git"),
	stepTag("github"),
	stepTag("mcp"),
	{
		key: "agent",
		label: "Subagents",
		...LANE_LOOK.agent,
		count: (turn) => turn.subagentEvents?.length ?? 0,
	},
];

export function railTagTint(key: string): string | undefined {
	return RAIL_TAGS.find((tag) => tag.key === key)?.tint;
}

export function TagChip({
	tag,
	title,
	flat = false,
	small = false,
	solid = false,
}: {
	tag: Pick<RailTag, "glyph" | "tint">;
	title?: string;
	flat?: boolean;
	small?: boolean;
	solid?: boolean;
}) {
	const Glyph = tag.glyph;
	return (
		<OpalChip
			solid={solid}
			tint={tag.tint}
			title={title}
			className={cn(small && "size-4", flat && "drop-shadow-none")}
		>
			<Glyph
				aria-hidden="true"
				className={small ? "size-2.5" : "size-3"}
				style={{ color: tag.tint }}
			/>
		</OpalChip>
	);
}

export function RailTags({
	picked,
	turn,
}: {
	picked: readonly string[];
	turn: SessionDetailTurnSummary;
}) {
	const shown = RAIL_TAGS.flatMap((tag) => {
		const count = picked.includes(tag.key) ? tag.count(turn) : 0;
		return count > 0 ? [{ count, tag }] : [];
	});
	if (shown.length === 0) return null;
	return (
		<span className="flex shrink-0 items-center gap-s">
			{shown.map(({ count, tag }) => (
				<span key={tag.key} className="flex items-center gap-xxs">
					<TagChip small tag={tag} title={`${tag.label}: ${count}`} />
					<span className="text-body-xs text-ink-3 tabular-nums">{count}</span>
				</span>
			))}
		</span>
	);
}

export type RailTagsState = {
	allRunsFolded: boolean;
	allRunsOpen: boolean;
	filters: readonly string[];
	hidden: ReadonlySet<string>;
	keeps: (turn: SessionDetailTurnSummary) => boolean;
	picked: readonly string[];
	setAllRunsOpen: (open: boolean) => void;
	setFilters: (keys: readonly string[]) => void;
	setHidden: (keys: ReadonlySet<string>) => void;
	setPicked: (keys: readonly string[]) => void;
};

export function useRailTags(runUi: RunUiStore): RailTagsState {
	const [picked, setPickedState] = useState<readonly string[]>([]);
	const [filters, setFilters] = useState<readonly string[]>([]);
	const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
	const allRunsOpen = useAllRunsOpen(runUi);
	const allRunsFolded = useAllRunsFolded(runUi);
	const setPicked = useCallback((keys: readonly string[]) => {
		setPickedState(keys);
		setFilters((current) => current.filter((key) => keys.includes(key)));
	}, []);
	const keeps = useCallback(
		(turn: SessionDetailTurnSummary) =>
			filters.length === 0 ||
			RAIL_TAGS.some((tag) => filters.includes(tag.key) && tag.count(turn) > 0),
		[filters],
	);
	return useMemo(
		() => ({
			allRunsFolded,
			allRunsOpen,
			filters,
			hidden,
			keeps,
			picked,
			setAllRunsOpen: runUi.setAllOpen,
			setFilters,
			setHidden,
			setPicked,
		}),
		[
			allRunsFolded,
			allRunsOpen,
			filters,
			hidden,
			keeps,
			picked,
			runUi,
			setPicked,
		],
	);
}

function FigureToggle({
	onPick,
	options,
	value,
}: {
	onPick: (value: string) => void;
	options: readonly { glyph: Icon; label: string; value: string }[];
	value: string;
}) {
	return (
		<div className="flex justify-center px-m py-xs">
			<ViewToggle
				label="Beside each turn"
				onPick={onPick}
				options={options.map((option) => ({
					icon: option.glyph,
					id: option.value,
					label: option.label,
				}))}
				value={value}
			/>
		</div>
	);
}

export function RailTagsPicker({
	figure,
}: {
	figure: {
		onPick: (value: string) => void;
		options: readonly {
			glyph: Icon;
			label: string;
			value: string;
		}[];
		value: string;
	};
}) {
	return (
		<Menu.Root>
			<Tip label="Beside each turn" side="bottom">
				<Menu.Trigger
					aria-label="Beside each turn"
					className={cn(
						"relative inline-flex size-7 shrink-0 items-center justify-center",
						"corner-full",
						"bg-surface text-ink-3 shadow-card transition-colors",
						"hover:bg-hover data-popup-open:bg-hover",
					)}
				>
					<IconAdjustmentsHorizontal aria-hidden="true" className="size-3.5" />
				</Menu.Trigger>
			</Tip>
			<SessionMenuPopup
				align="end"
				fluidHover={false}
				aria-label="Beside each turn"
				style={{ width: "max-content" }}
			>
				<FigureToggle
					onPick={figure.onPick}
					options={figure.options}
					value={figure.value}
				/>
			</SessionMenuPopup>
		</Menu.Root>
	);
}
