import { Menu } from "@base-ui/react/menu";
import {
	MOMENT_KINDS,
	type MomentKind,
	type MomentObservation,
	type NoticeableRun,
	type RunFlag,
} from "@rudel/api-routes";
import {
	IconAlertTriangle,
	IconAlertTriangleFilled,
	IconChevronDown,
	IconSparkles,
	IconThumbDown,
	IconThumbUp,
	type Icon as TablerIcon,
} from "@tabler/icons-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useState,
} from "react";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { SessionMenuPopup } from "@/features/sessions/components/session-menu-popup";
import { formatReaderCost } from "@/features/sessions/reader/model/session-reader-model";
import "@/features/sessions/components/session-menu.css";
import { FlowNumber } from "@/app/ui/flow-number";
import {
	ShellNavIcon,
	type ShellNavTone,
} from "@/features/shell/components/shell-nav-icon";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { PLAIN_NUMBER } from "@/lib/figure";
import { client } from "@/lib/orpc";
import {
	layerGroup,
	MOMENT_KINDS_APPEARANCE,
	MOMENT_LAYER_LABELS,
} from "./moment-labels";

const shortDate = (iso: string) =>
	new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});

/** The words a run's row leads with: the lesson once observed, else the run's prompt. */
export function momentHeadline(run: NoticeableRun): string {
	return run.observation && !run.observation.falsePositive
		? run.observation.lesson
		: (run.prompt ?? run.flags[0]?.detail ?? "Run");
}

/** A run's flags as one line: their labels, in order. */
export function flagLabels(run: NoticeableRun): string {
	return run.flags
		.map((flag) => MOMENT_KINDS_APPEARANCE[flag.kind].label)
		.join(" · ");
}

/** Up to three of a run's flags as their glyphs, side by side. */
export function FlagGlyphs({ flags }: { flags: readonly RunFlag[] }) {
	return (
		<span className="compass-glyphs" aria-hidden="true">
			{flags.slice(0, 3).map((flag) => {
				const kind = MOMENT_KINDS_APPEARANCE[flag.kind];
				const Glyph = kind.icon;
				return (
					<Glyph
						key={flag.kind}
						className="compass-row-glyph"
						style={{ "--glyph-color": kind.color } as CSSProperties}
					/>
				);
			})}
		</span>
	);
}

/**
 * A run in the list, as an inbox row: its first flag's glyph, what to read
 * (the lesson once observed, else the prompt), its flags and member; cost
 * and day on the right.
 */
export function RunRow({
	run,
	selected,
	onSelect,
	onKeyDown,
}: {
	run: NoticeableRun;
	selected: boolean;
	onSelect: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
	const { userMap } = useUserMap();
	const observation = run.observation;
	const notFriction = observation?.falsePositive === true;
	const lead = run.flags[0] ? MOMENT_KINDS_APPEARANCE[run.flags[0].kind] : null;
	const LeadGlyph = lead?.icon;
	return (
		<button
			type="button"
			className={`compass-item${notFriction ? " compass-row-muted" : ""}`}
			aria-current={selected || undefined}
			data-compass-item=""
			onClick={onSelect}
			onKeyDown={onKeyDown}
			title={momentHeadline(run)}
		>
			<span
				className="compass-item-icon"
				style={{ "--glyph-color": lead?.color } as CSSProperties}
				aria-hidden="true"
			>
				{LeadGlyph ? <LeadGlyph className="compass-row-glyph" /> : null}
			</span>
			<span className="compass-item-copy">
				<span className="compass-row-title truncate">
					{momentHeadline(run)}
				</span>
				<span className="compass-row-sub truncate">
					{flagLabels(run)} · {userMap[run.userId] ?? "Member"}
				</span>
			</span>
			<span className="compass-item-side">
				<span className="inline-flex items-center gap-1">
					{observation && !notFriction ? (
						<IconSparkles aria-label="Observed" className="size-3.5" />
					) : null}
					{formatReaderCost(run.costUsd)}
				</span>
				<span>{shortDate(run.startedAt)}</span>
			</span>
		</button>
	);
}

/** The list's flag filter: the sessions toolbar's checkbox menu, opened from a muted text button. */
export function KindsMenu({
	kinds,
	counts,
	onChange,
}: {
	kinds: readonly MomentKind[];
	counts: Record<MomentKind, number> | undefined;
	onChange: (kinds: MomentKind[]) => void;
}) {
	return (
		<Menu.Root>
			<Menu.Trigger
				className="cost-text-button inline-flex items-center gap-0.5"
				aria-label={
					kinds.length > 0
						? `Filter runs by flag, ${kinds.length} active`
						: "Filter runs by flag"
				}
			>
				Flags
				{kinds.length > 0 ? (
					<span className="compass-filter-count">
						<FlowNumber value={kinds.length} format={PLAIN_NUMBER} />
					</span>
				) : null}
				<IconChevronDown aria-hidden="true" className="size-3.5" />
			</Menu.Trigger>
			<FlagKindsPopup
				count={(kind) => counts?.[kind] ?? 0}
				onChange={onChange}
				options={MOMENT_KINDS}
				picked={kinds}
			/>
		</Menu.Root>
	);
}

const FLAG_TONE: ShellNavTone = {
	chip: "[--opal-fill:color-mix(in_oklch,var(--flag-tint)_14%,var(--session-menu-background))] [--opal-ring:color-mix(in_oklch,var(--flag-tint)_20%,transparent)] drop-shadow-[0_1.5px_2px_color-mix(in_oklch,var(--flag-tint)_25%,transparent)]",
	glyph: "text-(--flag-tint)",
};

function FlagKindRow({
	checked,
	children,
	count,
	filled,
	joins,
	onCheckedChange,
	outline,
	tint,
}: {
	checked: boolean;
	children: ReactNode;
	count: number;
	filled: TablerIcon | null;
	joins: { next: boolean; previous: boolean };
	onCheckedChange: (checked: boolean) => void;
	outline: TablerIcon;
	tint: string;
}) {
	return (
		<Menu.CheckboxItem
			checked={checked}
			onCheckedChange={onCheckedChange}
			className="session-menu-row"
			data-join-next={(checked && joins.next) || undefined}
			data-join-previous={(checked && joins.previous) || undefined}
			style={{ "--flag-tint": tint } as CSSProperties}
		>
			<ShellNavIcon
				active={checked}
				activeIcon={filled ?? outline}
				icon={outline}
				tone={FLAG_TONE}
			/>
			<span className="flex-1">{children}</span>
			<span className="tabular-nums text-(--session-menu-icon)">{count}</span>
		</Menu.CheckboxItem>
	);
}

export function FlagKindsPopup({
	align = "end",
	any,
	count,
	onChange,
	options,
	picked,
}: {
	align?: "center" | "end" | "start";
	any?: { count: number; label: string };
	count: (kind: MomentKind) => number;
	onChange: (kinds: MomentKind[]) => void;
	options: readonly MomentKind[];
	picked: readonly MomentKind[];
}) {
	const all = options.every((kind) => picked.includes(kind));
	const rows = [
		...(any ? [all] : []),
		...options.map((kind) => picked.includes(kind)),
	];
	const joinsAt = (index: number) => ({
		next: rows[index + 1] === true,
		previous: rows[index - 1] === true,
	});
	const offset = any ? 1 : 0;
	return (
		<SessionMenuPopup
			align={align}
			aria-label="Flags"
			className="session-menu-picks"
		>
			{any ? (
				<FlagKindRow
					checked={all}
					count={any.count}
					joins={joinsAt(0)}
					filled={IconAlertTriangleFilled}
					outline={IconAlertTriangle}
					onCheckedChange={(next) => onChange(next ? [...options] : [])}
					tint="var(--color-rose-500)"
				>
					{any.label}
				</FlagKindRow>
			) : null}
			{options.map((kind, index) => {
				const appearance = MOMENT_KINDS_APPEARANCE[kind];
				return (
					<FlagKindRow
						key={kind}
						checked={picked.includes(kind)}
						count={count(kind)}
						filled={appearance.filled}
						joins={joinsAt(index + offset)}
						outline={appearance.outline}
						onCheckedChange={(next) =>
							onChange(
								options.filter((each) =>
									each === kind ? next : picked.includes(each),
								),
							)
						}
						tint={appearance.color}
					>
						{appearance.label}
					</FlagKindRow>
				);
			})}
		</SessionMenuPopup>
	);
}

const SAMPLE_PROMPTS = [
	"rm everything that auto runs for now.",
	"do hen",
	"ok get all",
	"does it have all the js and stuff?",
	"You're in the portfolio repo on branch claude/loving-volta",
	"<turn-context> Attached context: the shared agent reads first",
	"<turn-context> Attached context: worktree files",
	"<turn-context> <shared-agent> calls denied",
	"overlapping it",
	"still lower than the others on setup and files",
	"ah ignore last msg. go ahead.",
	"ok but now the below has weirdly and the rail jumps",
	"YES. go",
	"turn the selector of context / time / cost into a toggle",
	"why is the bill so high this month",
	"make the repo page the same structure as the session page",
];
const SAMPLE_FLAGS: NoticeableRun["flags"] = [
	{
		count: 8,
		detail: "$8.31, 9× the median run ($0.92); top 2% of 493 runs",
		kind: "expensive_run",
		spanEnd: 120,
		spanStart: 1,
	},
	{
		count: 25,
		detail: "25 min, 14× the median run (2 min); top 3% of 493 runs",
		kind: "long_run",
		spanEnd: 120,
		spanStart: 1,
	},
];

const sampleRun = (prompt: string, index: number): NoticeableRun => ({
	agentId: "",
	costUsd: 0.4 + (index % 5) * 0.6,
	flags: SAMPLE_FLAGS,
	id: `sample-run-${index}`,
	minutes: 25,
	model: "claude-opus-5-5",
	observation: null,
	prompt,
	sessionId: `sample-session-${index}`,
	startedAt: "2026-11-02T08:00:00.000Z",
	turn: index + 1,
	userId: "sample",
});

const COMPASS_SAMPLE_RUNS = SAMPLE_PROMPTS.map(sampleRun);
export const COMPASS_SAMPLE_RUN = sampleRun(
	"rm everything that auto runs for now.",
	8,
);

const NO_SELECT = () => {};

export function RowsSample() {
	return COMPASS_SAMPLE_RUNS.map((run, index) => (
		<RunRow
			key={run.id}
			run={run}
			selected={index === 0}
			onSelect={NO_SELECT}
			onKeyDown={NO_SELECT}
		/>
	));
}

export function ObservationCard({
	observation,
}: {
	observation: MomentObservation;
}) {
	const [feedback, setFeedback] = useState(observation.feedback);
	const vote = async (useful: boolean) => {
		setFeedback(
			await client.analytics.moments.feedback({
				observationId: observation.id,
				useful: feedback.mine === useful ? null : useful,
			}),
		);
	};
	if (observation.falsePositive)
		return (
			<div className="compass-observation">
				<span className="compass-hint">Not friction after all</span>
				<p>{observation.whatHappened}</p>
			</div>
		);
	const group = layerGroup(observation.layer);
	return (
		<article className="compass-observation" aria-label="Observation">
			<div className="flex flex-wrap items-center gap-2">
				<span
					className="compass-chip"
					style={{ "--chip-color": group.color } as CSSProperties}
				>
					<i aria-hidden="true" />
					{group.label} · {MOMENT_LAYER_LABELS[observation.layer]}
				</span>
				<span className="compass-hint tabular-nums">
					{Math.round(observation.confidence * 100)}% sure
				</span>
			</div>
			<p>{observation.whatHappened}</p>
			<p className="compass-observation-lesson">{observation.lesson}</p>
			{observation.evidence.length > 0 ? (
				<ul className="compass-evidence">
					{observation.evidence.map((item) => (
						<li key={`${item.record}-${item.quote}`}>
							<span className="tabular-nums">#{item.record}</span> “{item.quote}
							”
						</li>
					))}
				</ul>
			) : null}
			<div className="compass-feedback" data-fluid-menu-root="">
				<FluidMenuHover items="button" />
				<span>Did this help?</span>
				<button
					type="button"
					className="cost-text-button"
					aria-pressed={feedback.mine === true}
					aria-label="Useful"
					onClick={() => vote(true)}
				>
					<IconThumbUp aria-hidden="true" className="size-3.5" />
					{feedback.useful}
				</button>
				<button
					type="button"
					className="cost-text-button"
					aria-pressed={feedback.mine === false}
					aria-label="Not useful"
					onClick={() => vote(false)}
				>
					<IconThumbDown aria-hidden="true" className="size-3.5" />
					{feedback.notUseful}
				</button>
			</div>
		</article>
	);
}
