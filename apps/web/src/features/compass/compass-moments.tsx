import { Menu } from "@base-ui/react/menu";
import {
	MOMENT_KINDS,
	type MomentKind,
	type MomentObservation,
	type NoticeableRun,
	type RunFlag,
} from "@rudel/api-routes";
import {
	IconCheck,
	IconChevronDown,
	IconSparkles,
	IconThumbDown,
	IconThumbUp,
} from "@tabler/icons-react";
import { type CSSProperties, type KeyboardEvent, useState } from "react";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { formatReaderCost } from "@/features/sessions/components/session-reader-model";
import "@/features/sessions/components/session-menu.css";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
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
					<span className="compass-filter-count">{kinds.length}</span>
				) : null}
				<IconChevronDown aria-hidden="true" className="size-3.5" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner align="end" sideOffset={6} className="z-50">
					<Menu.Popup
						aria-label="Flags"
						data-fluid-menu-root=""
						className="session-menu-surface session-menu-sort"
					>
						<FluidMenuHover />
						<Menu.Group>
							<Menu.GroupLabel className="session-menu-heading">
								Flag
							</Menu.GroupLabel>
							{MOMENT_KINDS.map((kind) => {
								const checked = kinds.includes(kind);
								const appearance = MOMENT_KINDS_APPEARANCE[kind];
								const Glyph = appearance.icon;
								return (
									<Menu.CheckboxItem
										key={kind}
										checked={checked}
										onCheckedChange={(next) =>
											onChange(
												MOMENT_KINDS.filter((each) =>
													each === kind ? next : kinds.includes(each),
												),
											)
										}
										className="session-menu-row"
									>
										<span
											className="session-menu-sort-check"
											aria-hidden="true"
										>
											<span
												className="session-menu-checkbox"
												data-checked={checked}
											>
												{checked ? <IconCheck className="size-2.5" /> : null}
											</span>
										</span>
										<Glyph
											aria-hidden="true"
											className="size-3.5 shrink-0"
											style={{ color: appearance.color }}
										/>
										<span className="flex-1">{appearance.label}</span>
										<span className="tabular-nums text-(--session-menu-icon)">
											{counts?.[kind] ?? 0}
										</span>
									</Menu.CheckboxItem>
								);
							})}
						</Menu.Group>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

/** One blob per row slot, as the list loads. */
export function RowsSkeleton() {
	return (
		<div className="compass-list-skeleton" aria-hidden="true">
			{[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
				<div key={index}>
					<div className="cost-skeleton size-7 rounded-full" />
					<div className="flex flex-1 flex-col gap-1.5">
						<div className="cost-skeleton h-3.5 w-48" />
						<div className="cost-skeleton h-3 w-32" />
					</div>
				</div>
			))}
		</div>
	);
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
