import type { MomentPattern } from "@rudel/api-routes";
import {
	IconExternalLink,
	IconStack2Filled,
	IconTool,
} from "@tabler/icons-react";
import { type CSSProperties, type KeyboardEvent, useState } from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { SERIES_COLORS } from "@/features/costs/chart-colors";
import { formatReaderCost } from "@/features/sessions/components/session-reader-model";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { client } from "@/lib/orpc";
import { layerGroup, MOMENT_LAYER_LABELS } from "./moment-labels";

const shortDate = (iso: string) =>
	new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});

/** A pattern in the list, as an inbox row: its layer's colour, the lesson, how many observations say it. */
export function PatternRow({
	pattern,
	selected,
	onSelect,
	onKeyDown,
}: {
	pattern: MomentPattern;
	selected: boolean;
	onSelect: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
	const group = layerGroup(pattern.layer);
	return (
		<button
			type="button"
			className="compass-item"
			aria-current={selected || undefined}
			data-compass-item=""
			onClick={onSelect}
			onKeyDown={onKeyDown}
			title={pattern.label}
		>
			<span
				className="compass-item-icon"
				style={{ "--glyph-color": group.color } as CSSProperties}
				aria-hidden="true"
			>
				<IconStack2Filled className="compass-row-glyph" />
			</span>
			<span className="compass-item-copy">
				<span className="compass-row-title line-clamp-2">{pattern.label}</span>
				<span className="compass-row-sub truncate">
					{group.label} · {MOMENT_LAYER_LABELS[pattern.layer]}
					{pattern.fix ? " · Fixed" : ""}
				</span>
			</span>
			<span className="compass-item-side">
				<span>
					{pattern.runs} {pattern.runs === 1 ? "run" : "runs"}
				</span>
				<span>{formatReaderCost(pattern.costUsd)}</span>
			</span>
		</button>
	);
}

/** One pattern in the right pane: what it says, its weeks, its runs, and the fix recorded against it. */
export function PatternPane({
	pattern,
	range,
	onFixed,
}: {
	pattern: MomentPattern;
	range: { startDate: string; endDate: string };
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
			setNote("");
			onFixed();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};
	return (
		<article className="compass-detail" aria-label="Pattern">
			<header className="compass-detail-header">
				<div className="compass-detail-eyebrow">
					<span
						className="compass-chip"
						style={{ "--chip-color": group.color } as CSSProperties}
					>
						<i aria-hidden="true" />
						{group.label} · {MOMENT_LAYER_LABELS[pattern.layer]}
					</span>
				</div>
				<h2 className="compass-detail-title">{pattern.label}</h2>
				<p className="compass-detail-summary">{pattern.summary}</p>
			</header>
			<dl className="compass-properties">
				<div>
					<dt>Runs</dt>
					<dd>{pattern.runs}</dd>
				</div>
				<div>
					<dt>Members</dt>
					<dd>{pattern.members}</dd>
				</div>
				<div>
					<dt>Cost</dt>
					<dd>{formatReaderCost(pattern.costUsd)}</dd>
				</div>
			</dl>
			{pattern.weekly.length >= 3 ? (
				<section className="compass-detail-section" aria-label="Weeks">
					<h3>Per week</h3>
					<WeeklyBars
						weekly={pattern.weekly}
						fixedAt={pattern.fix?.createdAt}
					/>
				</section>
			) : null}
			<section className="compass-detail-section" aria-label="Runs">
				<h3>Runs that show it</h3>
				<div className="compass-example-list" data-fluid-menu-root="">
					<FluidMenuHover items=".compass-example" />
					{pattern.examples.map((example) => (
						<Link
							key={example.observationId}
							to={getShellRoutePath(appRoutes.sessionDetail(example.sessionId))}
							className="compass-example"
						>
							<span className="compass-item-copy">
								<span className="truncate">{example.whatHappened}</span>
								<span className="compass-row-sub truncate">
									{userMap[example.userId] ?? "Member"} · Run {example.turn}
								</span>
							</span>
							<span className="compass-row-sub inline-flex shrink-0 items-center gap-1">
								{shortDate(example.startedAt)}
								<IconExternalLink aria-hidden="true" className="size-3" />
							</span>
						</Link>
					))}
				</div>
			</section>
			<section className="compass-detail-section" aria-label="Fix">
				<h3>Fix</h3>
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
					<div className="flex flex-col gap-2">
						<span className="compass-hint">
							What did you change? A pointer, a check, a standard or a habit.
							Compass then shows how often this happens since.
						</span>
						<textarea
							value={note}
							onChange={(event) => setNote(event.target.value)}
							maxLength={500}
							aria-label="The fix"
							className="compass-note"
						/>
						<div>
							<button
								type="button"
								className="cost-secondary-button"
								disabled={busy || note.trim().length < 3}
								onClick={save}
							>
								{busy ? "Saving…" : "Record the fix"}
							</button>
						</div>
					</div>
				)}
				{error ? (
					<p role="alert" className="compass-error">
						{error}
					</p>
				) : null}
			</section>
		</article>
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
