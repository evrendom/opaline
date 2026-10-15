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
	IconExternalLink,
	IconSparkles,
	IconThumbDown,
	IconThumbUp,
} from "@tabler/icons-react";
import { type CSSProperties, useState } from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/app/ui/dialog";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { ScrollFade } from "@/features/costs/cost-breakdown";
import { formatReaderCost } from "@/features/sessions/components/session-reader-model";
import "@/features/sessions/components/session-menu.css";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
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

/**
 * The Noticeable runs card: every run of the range a flag marks, as a
 * breakdown row (its flags' glyphs, what to read, which flags; cost and day
 * on the right), newest first. The heading filters by flag and by whose runs.
 */
export function MomentsCard({
	runs,
	counts,
	pending,
	error,
	kinds,
	onKindsChange,
	mine,
	onMineChange,
	hasMore,
	loadingMore,
	onLoadMore,
	onOpen,
}: {
	runs: NoticeableRun[];
	counts: Record<MomentKind, number> | undefined;
	pending: boolean;
	error: string | null;
	kinds: readonly MomentKind[];
	onKindsChange: (kinds: MomentKind[]) => void;
	mine: boolean;
	onMineChange: (mine: boolean) => void;
	hasMore: boolean;
	loadingMore: boolean;
	onLoadMore: () => void;
	onOpen: (run: NoticeableRun) => void;
}) {
	return (
		<section
			className="cost-breakdown compass-moments"
			aria-label="Noticeable runs"
			aria-busy={pending}
		>
			<div className="cost-breakdown-heading">
				<h2 title="Runs a flag marks: searches, cost, edits, failures, reverts, apologies, frustration… Flags only point; open a run to read it.">
					Noticeable runs
				</h2>
				<div className="compass-heading-controls" data-fluid-menu-root="">
					<FluidMenuHover items="button" />
					<button
						type="button"
						className="cost-text-button"
						aria-pressed={!mine}
						onClick={() => onMineChange(false)}
					>
						Everyone
					</button>
					<button
						type="button"
						className="cost-text-button"
						aria-pressed={mine}
						onClick={() => onMineChange(true)}
					>
						Mine
					</button>
					<KindsMenu kinds={kinds} counts={counts} onChange={onKindsChange} />
				</div>
			</div>
			<ScrollFade
				className="cost-breakdown-list"
				data-many={runs.length > 4 || undefined}
			>
				{pending ? (
					<RowsSkeleton />
				) : error ? (
					<p className="cost-breakdown-empty">{error}</p>
				) : runs.length === 0 ? (
					<p className="cost-breakdown-empty">
						{kinds.length > 0 || mine
							? "No matching runs."
							: "No noticeable runs in this range. A run shows up here when one of the flags in Settings › Compass marks it."}
					</p>
				) : (
					<div data-fluid-menu-root="">
						<FluidMenuHover items=".cost-breakdown-row" />
						{runs.map((run) => (
							<RunRow key={run.id} run={run} onOpen={() => onOpen(run)} />
						))}
						{hasMore ? (
							<div className="compass-more">
								<button
									type="button"
									className="cost-text-button"
									disabled={loadingMore}
									onClick={onLoadMore}
								>
									{loadingMore ? "Loading…" : "Show more runs"}
								</button>
							</div>
						) : null}
					</div>
				)}
			</ScrollFade>
		</section>
	);
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

function RunRow({ run, onOpen }: { run: NoticeableRun; onOpen: () => void }) {
	const { userMap } = useUserMap();
	const observation = run.observation;
	const notFriction = observation?.falsePositive === true;
	return (
		<button
			type="button"
			className={`cost-breakdown-row${notFriction ? " compass-row-muted" : ""}`}
			onClick={onOpen}
			title={momentHeadline(run)}
		>
			<span className="cost-row-identity">
				<FlagGlyphs flags={run.flags} />
				<span className="compass-row-copy">
					<span className="compass-row-title truncate">
						{momentHeadline(run)}
					</span>
					<span className="compass-row-sub truncate">
						{flagLabels(run)}
						{observation && !notFriction
							? ` · ${MOMENT_LAYER_LABELS[observation.layer]}`
							: ""}
						{" · "}
						{userMap[run.userId] ?? "Member"}
					</span>
				</span>
				{observation && !notFriction ? (
					<IconSparkles
						aria-label="Observed"
						className="size-3.5 shrink-0 text-(--cost-muted)"
					/>
				) : null}
			</span>
			<span className="cost-row-amount">
				{formatReaderCost(run.costUsd)}
				<span className="compass-row-when">{shortDate(run.startedAt)}</span>
			</span>
		</button>
	);
}

/** The heading's flag filter: the sessions toolbar's checkbox menu, opened from a muted text button. */
function KindsMenu({
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

/** One blob per row slot, as the dashboard's breakdown cards load. */
export function RowsSkeleton() {
	return (
		<div className="cost-breakdown-skeleton" aria-hidden="true">
			{[0, 1, 2, 3, 4, 5].map((index) => (
				<div key={index}>
					<div className="cost-breakdown-skeleton-name">
						<div className="cost-skeleton size-3.5 rounded-full" />
						<div className="cost-skeleton h-3.5 w-48" />
					</div>
					<div className="cost-breakdown-skeleton-value">
						<div className="cost-skeleton h-3.5 w-12" />
						<div className="cost-skeleton h-2.5 w-10" />
					</div>
				</div>
			))}
		</div>
	);
}

/**
 * One noticeable run, in the dashboard's breakdown dialog: its flags and
 * what each saw, the run's prompt, and its observation, or the button that
 * asks Claude to read just the flagged records.
 */
export function MomentDialog({
	run,
	range,
	observable,
	onClose,
	onObserved,
}: {
	run: NoticeableRun | null;
	range: { startDate: string; endDate: string };
	observable: boolean;
	onClose: () => void;
	onObserved: () => void;
}) {
	return (
		<Dialog
			open={run !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="cost-breakdown-dialog gap-4 sm:max-w-xl">
				{run ? (
					<RunDetail
						key={run.id}
						run={run}
						range={range}
						observable={observable}
						onClose={onClose}
						onObserved={onObserved}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RunDetail({
	run,
	range,
	observable,
	onClose,
	onObserved,
}: {
	run: NoticeableRun;
	range: { startDate: string; endDate: string };
	observable: boolean;
	onClose: () => void;
	onObserved: () => void;
}) {
	const { userMap } = useUserMap();
	const getShellRoutePath = useShellRoutePath();
	const [observation, setObservation] = useState<MomentObservation | null>(
		run.observation,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const observe = async () => {
		setBusy(true);
		setError(null);
		try {
			setObservation(
				await client.analytics.moments.observe({
					userId: run.userId,
					sessionId: run.sessionId,
					agentId: run.agentId,
					turn: run.turn,
					startDate: range.startDate,
					endDate: range.endDate,
				}),
			);
			onObserved();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<DialogTitle className="line-clamp-2 leading-snug">
				{run.prompt ?? `Run ${run.turn}`}
			</DialogTitle>
			<DialogDescription className="sr-only">
				{flagLabels(run)}
			</DialogDescription>
			<div className="compass-dialog-meta">
				<span>{userMap[run.userId] ?? "Member"}</span>
				<span>·</span>
				<span>{shortDate(run.startedAt)}</span>
				<span>·</span>
				<span>
					Run {run.turn}
					{run.agentId ? " of a subagent" : ""}
				</span>
				<span>·</span>
				<span>{Math.max(1, Math.round(run.minutes))} min</span>
				<span>·</span>
				<span>{formatReaderCost(run.costUsd)}</span>
			</div>
			<ul className="compass-flags" aria-label="Flags">
				{run.flags.map((flag) => {
					const kind = MOMENT_KINDS_APPEARANCE[flag.kind];
					const Glyph = kind.icon;
					return (
						<li key={flag.kind}>
							<Glyph
								aria-hidden="true"
								className="compass-row-glyph"
								style={{ "--glyph-color": kind.color } as CSSProperties}
							/>
							<span className="font-medium">{kind.label}</span>
							<span className="compass-row-sub truncate" title={flag.detail}>
								{flag.detail}
							</span>
						</li>
					);
				})}
			</ul>
			{observation ? (
				<ObservationCard observation={observation} />
			) : observable ? (
				<div className="flex flex-col items-start gap-1.5">
					<button
						type="button"
						className="cost-secondary-button inline-flex items-center gap-1.5"
						onClick={observe}
						disabled={busy}
					>
						<IconSparkles aria-hidden="true" className="size-4" />
						{busy ? "Reading the run…" : "Observe with Claude"}
					</button>
					<span className="compass-hint">
						Sends only this run’s flagged records to Anthropic. The note is kept
						for your workspace.
					</span>
				</div>
			) : (
				<p className="compass-hint">
					Observations aren’t turned on for this workspace.
				</p>
			)}
			{error ? (
				<p role="alert" className="compass-error">
					{error}
				</p>
			) : null}
			<div className="cost-dialog-footer" data-fluid-menu-root="">
				<FluidMenuHover items="a, button" />
				<Link
					to={getShellRoutePath(appRoutes.sessionDetail(run.sessionId))}
					className="cost-text-button inline-flex items-center gap-1"
				>
					Open the session
					<IconExternalLink aria-hidden="true" className="size-3.5" />
				</Link>
				<button
					type="button"
					className="cost-secondary-button"
					onClick={onClose}
				>
					Done
				</button>
			</div>
		</>
	);
}

function ObservationCard({ observation }: { observation: MomentObservation }) {
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
