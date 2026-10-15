import type { MomentPattern } from "@rudel/api-routes";
import { IconExternalLink, IconTool } from "@tabler/icons-react";
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
import { SERIES_COLORS } from "@/features/costs/chart-colors";
import { ScrollFade } from "@/features/costs/cost-breakdown";
import { formatReaderCost } from "@/features/sessions/components/session-reader-model";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { client } from "@/lib/orpc";
import { RowsSkeleton } from "./compass-moments";
import { layerGroup, MOMENT_LAYER_LABELS } from "./moment-labels";

const shortDate = (iso: string) =>
	new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});

/**
 * The Patterns card: observations that say the same thing, the most
 * widespread first, as breakdown rows with a share bar scaled to the largest.
 */
export function PatternsCard({
	patterns,
	pending,
	error,
	onOpen,
}: {
	patterns: MomentPattern[];
	pending: boolean;
	error: string | null;
	onOpen: (pattern: MomentPattern) => void;
}) {
	const maximum = Math.max(1, ...patterns.map((each) => each.observations));
	return (
		<section
			className="cost-breakdown"
			aria-label="Patterns"
			aria-busy={pending}
		>
			<div className="cost-breakdown-heading">
				<h2 title="Observations that say the same thing, grouped by where a fix belongs.">
					Patterns
				</h2>
				<div>Runs</div>
			</div>
			<ScrollFade
				className="cost-breakdown-list"
				data-many={patterns.length > 4 || undefined}
			>
				{pending ? (
					<RowsSkeleton />
				) : error ? (
					<p className="cost-breakdown-empty">{error}</p>
				) : patterns.length === 0 ? (
					<p className="cost-breakdown-empty">
						Patterns form from observed runs. Observe a few noticeable runs,
						then come back.
					</p>
				) : (
					<div data-fluid-menu-root="">
						<FluidMenuHover items=".cost-breakdown-row" />
						{patterns.map((pattern) => {
							const group = layerGroup(pattern.layer);
							return (
								<button
									key={pattern.id}
									type="button"
									className="cost-breakdown-row"
									onClick={() => onOpen(pattern)}
									title={pattern.label}
								>
									<span className="cost-row-identity">
										<span className="compass-row-copy">
											<span className="compass-row-title line-clamp-2">
												{pattern.label}
											</span>
											<span className="compass-row-sub truncate">
												{group.label} · {MOMENT_LAYER_LABELS[pattern.layer]}
												{pattern.fix ? " · Fixed" : ""}
											</span>
										</span>
									</span>
									<span className="cost-row-amount">
										{pattern.observations}
										<span className="cost-row-meter" aria-hidden="true">
											<span
												style={{
													width: `${Math.max(2, (pattern.observations / maximum) * 100)}%`,
													backgroundColor: group.color,
												}}
											/>
										</span>
									</span>
								</button>
							);
						})}
					</div>
				)}
			</ScrollFade>
		</section>
	);
}

/** One pattern, in the dashboard's breakdown dialog: its weeks, examples, and the fix recorded against it. */
export function PatternDialog({
	pattern,
	range,
	onClose,
	onFixed,
}: {
	pattern: MomentPattern | null;
	range: { startDate: string; endDate: string };
	onClose: () => void;
	onFixed: () => void;
}) {
	return (
		<Dialog
			open={pattern !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="cost-breakdown-dialog gap-4 sm:max-w-xl">
				{pattern ? (
					<PatternDetail
						key={pattern.id}
						pattern={pattern}
						range={range}
						onClose={onClose}
						onFixed={onFixed}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function PatternDetail({
	pattern,
	range,
	onClose,
	onFixed,
}: {
	pattern: MomentPattern;
	range: { startDate: string; endDate: string };
	onClose: () => void;
	onFixed: () => void;
}) {
	const { userMap } = useUserMap();
	const getShellRoutePath = useShellRoutePath();
	const group = layerGroup(pattern.layer);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const save = async () => {
		setBusy(true);
		setError(null);
		try {
			await client.analytics.moments.recordFix({
				patternId: pattern.id,
				note,
				...range,
			});
			onFixed();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<DialogTitle className="leading-snug">{pattern.label}</DialogTitle>
			<DialogDescription className="text-pretty">
				{pattern.summary}
			</DialogDescription>
			<div className="compass-dialog-meta">
				<span
					className="compass-chip"
					style={{ "--chip-color": group.color } as CSSProperties}
				>
					<i aria-hidden="true" />
					{group.label} · {MOMENT_LAYER_LABELS[pattern.layer]}
				</span>
				<span className="tabular-nums">
					{pattern.runs} {pattern.runs === 1 ? "run" : "runs"} ·{" "}
					{pattern.members} {pattern.members === 1 ? "member" : "members"} ·{" "}
					{formatReaderCost(pattern.costUsd)}
				</span>
			</div>
			{pattern.weekly.length >= 3 ? (
				<WeeklyBars weekly={pattern.weekly} fixedAt={pattern.fix?.createdAt} />
			) : null}
			<div className="cost-expanded-list" data-fluid-menu-root="">
				<FluidMenuHover items=".cost-breakdown-row" />
				{pattern.examples.map((example) => {
					return (
						<Link
							key={example.observationId}
							to={getShellRoutePath(appRoutes.sessionDetail(example.sessionId))}
							className="cost-breakdown-row"
						>
							<span className="cost-row-identity">
								<span className="compass-row-copy">
									<span className="truncate">{example.whatHappened}</span>
									<span className="compass-row-sub truncate">
										{userMap[example.userId] ?? "Member"} · Run {example.turn}
									</span>
								</span>
							</span>
							<span className="cost-row-amount compass-row-sub inline-flex items-center gap-1">
								{shortDate(example.startedAt)}
								<IconExternalLink aria-hidden="true" className="size-3" />
							</span>
						</Link>
					);
				})}
			</div>
			{pattern.fix ? (
				<div className="compass-fix">
					<span className="inline-flex items-center gap-1.5 font-medium">
						<IconTool aria-hidden="true" className="size-3.5" />
						Fixed {shortDate(pattern.fix.createdAt)}: {pattern.fix.note}
					</span>
					<span className="compass-fix-rate">
						{pattern.fix.beforePerWeek.toFixed(1)} a week before →{" "}
						{pattern.fix.afterPerWeek === null
							? "too early to tell"
							: `${pattern.fix.afterPerWeek.toFixed(1)} a week since`}
					</span>
				</div>
			) : (
				<label className="flex flex-col gap-1.5 text-[0.8125rem]">
					<span>Record a fix</span>
					<span className="compass-hint">
						What did you change? A pointer, a check, a standard or a habit.
						Compass then shows how often this happens since.
					</span>
					<textarea
						value={note}
						onChange={(event) => setNote(event.target.value)}
						maxLength={500}
						className="compass-note"
					/>
				</label>
			)}
			{error ? (
				<p role="alert" className="compass-error">
					{error}
				</p>
			) : null}
			<div className="cost-dialog-footer" data-fluid-menu-root="">
				<FluidMenuHover items="button" />
				<button type="button" className="cost-text-button" onClick={onClose}>
					{pattern.fix ? "Close" : "Cancel"}
				</button>
				{pattern.fix ? (
					<button
						type="button"
						className="cost-secondary-button"
						onClick={onClose}
					>
						Done
					</button>
				) : (
					<button
						type="button"
						className="cost-secondary-button"
						disabled={busy || note.trim().length < 3}
						onClick={save}
					>
						{busy ? "Saving…" : "Save fix"}
					</button>
				)}
			</div>
		</>
	);
}

/** Moments per week, amber before a fix and green in the weeks after its own. */
function WeeklyBars({
	weekly,
	fixedAt,
}: {
	weekly: MomentPattern["weekly"];
	fixedAt?: string;
}) {
	const max = Math.max(1, ...weekly.map((week) => week.count));
	const fixedWeek = fixedAt ? mondayOf(new Date(fixedAt)) : null;
	return (
		<div
			className="compass-weeks"
			role="img"
			aria-label={`Moments per week: ${weekly
				.map((week) => `week of ${week.week}, ${week.count}`)
				.join("; ")}`}
		>
			{weekly.map((week) => (
				<span
					key={week.week}
					title={`Week of ${week.week}: ${week.count}`}
					style={
						{
							height: `${Math.max(6, (week.count / max) * 100)}%`,
							"--bar-color":
								fixedWeek && week.week > fixedWeek
									? SERIES_COLORS[2]
									: SERIES_COLORS[3],
						} as CSSProperties
					}
				/>
			))}
		</div>
	);
}

/** The ISO week's Monday of a date, as `YYYY-MM-DD` (UTC), like the API's weeks. */
function mondayOf(date: Date): string {
	const day = (date.getUTCDay() + 6) % 7;
	return new Date(
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth(),
			date.getUTCDate() - day,
		),
	)
		.toISOString()
		.slice(0, 10);
}
