import type {
	CostBreakdownEntry,
	CostDimension,
	DashboardMetric,
} from "@rudel/api-routes";
import type { Icon } from "@tabler/icons-react";
import {
	IconArrowsDiagonal,
	IconCheck,
	IconDownload,
	IconGitBranch,
	IconGitFork,
	IconMessage2,
} from "@tabler/icons-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useIntroHold, useIntroSettled } from "@/app/first-open";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Reveal } from "@/app/ui/bones";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/app/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import { getModelBadgeTone } from "@/features/dashboard/components/dashboard-model-brand";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { BreakdownEmpty } from "./breakdown-empty";
import { SERIES_COLORS } from "./chart-colors";
import {
	costLabel,
	formatMetricRatio,
	formatRunDuration,
	METRIC_LABELS,
} from "./cost-format";
import { COST_LABELS } from "./use-cost-dashboard";

type Props = {
	dimension: CostDimension;
	metric: DashboardMetric;
	unavailable: boolean;
	valueLabel: string;
	entries: CostBreakdownEntry[];
	selected: string[];
	pending: boolean;
	split: boolean;
	onToggle: (id: string) => void;
	onSplit: () => void;
	onClear: () => void;
	/** Set while the rows are not loaded yet (plugin app); shows a load button. */
	onLoadDeferred?: () => void;
};

const INTRO_ROW_SCALES = [1, 0.62, 0.41, 0.27, 0.18, 0.11];

export function CostBreakdown({
	dimension,
	metric,
	unavailable,
	valueLabel,
	entries,
	selected,
	pending,
	split,
	onToggle,
	onSplit,
	onClear,
	onLoadDeferred,
}: Props) {
	const [expanded, setExpanded] = useState(false);
	const introHold = useIntroHold();
	const introSettled = useIntroSettled();
	const holding = introHold && introSettled;
	const [search, setSearch] = useState("");
	const label = COST_LABELS[dimension];
	const maximum = Math.max(0, ...entries.map((entry) => entry.value));
	const empty =
		!pending && !onLoadDeferred && entries.every((entry) => entry.value === 0);
	const filtered = entries.filter((entry) =>
		`${entry.id} ${costLabel(dimension, entry.label)}`
			.toLowerCase()
			.includes(search.toLowerCase()),
	);
	const description = getBreakdownDescription(dimension, metric);
	// Share bars take the series colours the chart uses when split by this
	// dimension (rows are ranked the same way).
	const colorOf = new Map(
		entries.map((entry, index) => [
			entry.id,
			SERIES_COLORS[index % (SERIES_COLORS.length - 1)] ?? SERIES_COLORS[0],
		]),
	);
	return (
		<>
			<section
				className="cost-breakdown"
				data-dimension={dimension}
				data-empty={empty || undefined}
				aria-label={label}
				aria-busy={pending}
			>
				<div className="cost-breakdown-heading">
					<h2 title={description}>{label}</h2>
					<div>
						{selected.length ? (
							<span className="cost-breakdown-selected">
								{selected.length} selected
							</span>
						) : metric === "cost" ? (
							<>
								{METRIC_LABELS.cost}{" "}
								<span className="cost-heading-currency">USD</span>
							</>
						) : metric === "signals" ? (
							"Signals"
						) : (
							METRIC_LABELS[metric]
						)}
					</div>
				</div>
				<ScrollFade
					className="cost-breakdown-list"
					data-many={entries.length > 4 || undefined}
					data-empty={empty || undefined}
				>
					{!pending && onLoadDeferred ? (
						<p className="cost-breakdown-empty">
							<button
								type="button"
								className="cost-breakdown-load"
								onClick={onLoadDeferred}
							>
								Show {label.toLowerCase()}
							</button>
						</p>
					) : empty ? (
						<BreakdownEmpty
							title={
								unavailable
									? metric === "mergedPullRequests" ||
										metric === "ciFailuresPerPullRequest"
										? "Pull request data unavailable"
										: "Still being indexed"
									: `No ${label.toLowerCase().replace("github", "GitHub")}`
							}
						/>
					) : (
						<Reveal
							label={`Loading ${label.toLowerCase()}`}
							loading={pending}
							sample={<BreakdownSample dimension={dimension} metric={metric} />}
							sampleId={`cost-breakdown-${dimension}`}
						>
							{() => (
								<div data-fluid-menu-root="">
									<FluidMenuHover items=".cost-breakdown-row" />
									{entries.map((entry) => (
										<BreakdownRow
											key={entry.id}
											dimension={dimension}
											metric={metric}
											entry={entry}
											maximum={maximum}
											color={colorOf.get(entry.id) ?? SERIES_COLORS[0]}
											selected={selected.includes(entry.id)}
											onToggle={onToggle}
										/>
									))}
									{holding
										? INTRO_ROW_SCALES.slice(entries.length).map(
												(scale, at) => {
													const source = entries[at % entries.length];
													if (!source) return null;
													return (
														<BreakdownRow
															key={`intro-${scale}`}
															dimension={dimension}
															metric={metric}
															entry={{
																...source,
																id: `intro-${scale}`,
																value: source.value * scale,
															}}
															maximum={maximum}
															color={SERIES_COLORS[0]}
															selected={false}
															onToggle={() => {}}
														/>
													);
												},
											)
										: null}
								</div>
							)}
						</Reveal>
					)}
				</ScrollFade>
				<div className="cost-tools" data-open={split}>
					<div className="cost-tools-inner" data-fluid-menu-root="">
						<FluidMenuHover items=".cost-tool-button" />
						<ToolButton
							label={`View all ${label.toLowerCase()}`}
							icon={IconArrowsDiagonal}
							onClick={() => {
								setSearch("");
								setExpanded(true);
							}}
							disabled={pending || unavailable}
						/>
						<ToolButton
							label={split ? "Show total" : `Split by ${label.toLowerCase()}`}
							icon={IconGitFork}
							onClick={onSplit}
							pressed={split}
							disabled={pending || unavailable}
						/>
						<ToolButton
							label={`Download ${label.toLowerCase()} as CSV`}
							icon={IconDownload}
							onClick={() =>
								downloadBreakdown(dimension, entries, metric, valueLabel)
							}
							disabled={pending || entries.length === 0}
						/>
					</div>
				</div>
			</section>
			<Dialog open={expanded} onOpenChange={setExpanded}>
				<DialogContent className="cost-breakdown-dialog gap-4 sm:max-w-xl">
					<DialogTitle>{label}</DialogTitle>
					<DialogDescription>
						Select {label.toLowerCase()} to filter{" "}
						{metric === "cost" ? "costs" : METRIC_LABELS[metric].toLowerCase()}.
						Selections combine with your other filters.
					</DialogDescription>
					<input
						type="search"
						name={`search-${dimension}`}
						aria-label={`Search ${label.toLowerCase()}`}
						placeholder={`Search ${label.toLowerCase()}…`}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="cost-search"
					/>
					<div
						className="cost-expanded-list"
						aria-busy={pending}
						data-fluid-menu-root=""
					>
						<FluidMenuHover items=".cost-breakdown-row" />
						<Reveal
							label={`Loading ${label.toLowerCase()}`}
							loading={pending}
							sample={<BreakdownSample dimension={dimension} metric={metric} />}
							sampleId={`cost-breakdown-${dimension}-all`}
						>
							{() =>
								filtered.map((entry) => (
									<BreakdownRow
										key={entry.id}
										dimension={dimension}
										metric={metric}
										entry={entry}
										maximum={maximum}
										color={colorOf.get(entry.id) ?? SERIES_COLORS[0]}
										selected={selected.includes(entry.id)}
										onToggle={onToggle}
									/>
								))
							}
						</Reveal>
						{!pending && filtered.length === 0 ? (
							<p className="cost-breakdown-empty">No results.</p>
						) : null}
					</div>
					<div className="cost-dialog-footer" data-fluid-menu-root="">
						<FluidMenuHover items="button" />
						<button
							type="button"
							className="cost-text-button"
							onClick={onClear}
							disabled={selected.length === 0}
						>
							Clear selection
						</button>
						<button
							type="button"
							className="cost-secondary-button"
							onClick={() => setExpanded(false)}
						>
							Done{selected.length ? ` · ${selected.length} selected` : ""}
						</button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

function getBreakdownDescription(
	dimension: CostDimension,
	metric: DashboardMetric,
) {
	if (dimension === "runSignals") {
		return "Signal in the immediately following user reply. No signal means a reply without detected positive or negative feedback; No reply means no following user message.";
	}
	if (dimension === "durations") {
		return "Elapsed time from user prompt to final assistant message, including waits. Unknown duration is counted separately.";
	}
	if (dimension === "skillsUsed") {
		return "Whether the run contains a recorded skill invocation.";
	}
	if (
		(metric === "mergedPullRequests" ||
			metric === "ciFailuresPerPullRequest") &&
		dimension === "members"
	) {
		return "Member attribution uses linked Opaline session owners. A pull request can appear under multiple members when it links to multiple sessions.";
	}
	if (
		(metric === "mergedPullRequests" ||
			metric === "ciFailuresPerPullRequest") &&
		dimension === "models"
	) {
		return "A pull request can appear under multiple models when its linked sessions used more than one model.";
	}
	return undefined;
}

/**
 * BreakdownRow: glyph + name on the left; the value with a short
 * share bar under it on the right. A button here, toggling the row's filter.
 */
function BreakdownRow({
	entry,
	metric,
	dimension,
	maximum,
	color,
	selected,
	onToggle,
}: {
	entry: CostBreakdownEntry;
	metric: DashboardMetric;
	dimension: CostDimension;
	maximum: number;
	/** The share bar's colour. */
	color: string;
	selected: boolean;
	onToggle: (id: string) => void;
}) {
	const label = costLabel(dimension, entry.label);
	return (
		<button
			type="button"
			className="cost-breakdown-row"
			aria-pressed={selected}
			aria-label={`Filter ${COST_LABELS[dimension].toLowerCase()} by ${label}`}
			onClick={() => onToggle(entry.id)}
			title={`${label} · ${formatMetricRatio(entry.value, metric, entry.denominator)}`}
		>
			<span className="cost-row-identity">
				<EntryIcon dimension={dimension} entry={entry} />
				<span className="truncate">{label}</span>
				{selected ? <IconCheck size={14} className="shrink-0" /> : null}
			</span>
			<span className="cost-row-amount">
				{formatMetricRatio(entry.value, metric, entry.denominator)}
				{/* The share bar: scaled to the largest row, right-aligned. */}
				<span className="cost-row-meter" aria-hidden="true">
					<span
						style={{
							width: `${Math.max(2, maximum > 0 ? (entry.value / maximum) * 100 : 0)}%`,
							backgroundColor: color,
						}}
					/>
				</span>
				{entry.approximateMinutes !== undefined ? (
					<small
						className="cost-cycle-time"
						title="Approximation of billed Actions minutes; billing multipliers are not included."
					>
						{new Intl.NumberFormat("en-US", {
							maximumFractionDigits: 1,
						}).format(entry.approximateMinutes)}{" "}
						CI minutes (approx.)
					</small>
				) : null}
				{entry.medianSeconds !== undefined ? (
					<small className="cost-cycle-time">
						Median {formatRunDuration(entry.medianSeconds)} · P90{" "}
						{formatRunDuration(entry.p90Seconds)}
					</small>
				) : null}
			</span>
		</button>
	);
}

function EntryIcon({
	dimension,
	entry,
}: {
	dimension: CostDimension;
	entry: CostBreakdownEntry;
}) {
	const demo = useDemoRuntime();
	const image =
		demo?.seed.members.find((member) => member.userId === entry.id)?.image ??
		entry.image;
	// Bundled demo portraits must be present in the prerendered HTML. The
	// interactive Avatar waits for a client-side image load before showing it.
	if (dimension === "members" && demo && image)
		return (
			<img
				src={image}
				alt=""
				width={16}
				height={16}
				className="size-4 shrink-0 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10"
			/>
		);
	if (dimension === "members")
		return (
			<Avatar className="size-4 shrink-0 rounded-full ring-1 ring-black/5 dark:ring-white/10">
				<AvatarImage src={image ?? undefined} alt="" />
				<AvatarFallback className="cost-member-initial">
					{entry.label
						.split(/\s+/u)
						.slice(0, 2)
						.map((word) => word[0])
						.join("")}
				</AvatarFallback>
			</Avatar>
		);
	if (dimension === "repositories")
		return <IconGitBranch size={14} className="shrink-0" />;
	if (dimension === "signalTypes" || dimension === "phrases")
		return <IconMessage2 size={14} className="shrink-0" />;
	if (dimension !== "models") return null;
	const tone = getModelBadgeTone(entry.id);
	if (tone.icon === "claude")
		return <ClaudeModelIcon className="size-3.5 shrink-0" />;
	if (tone.icon === "codex")
		return <CodexModelIcon className="size-3.5 shrink-0" />;
	return (
		<span className="cost-unknown-model" aria-hidden="true">
			?
		</span>
	);
}

function ToolButton({
	label,
	icon: Glyph,
	onClick,
	disabled,
	pressed,
}: {
	label: string;
	icon: Icon;
	onClick: () => void;
	disabled: boolean;
	pressed?: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="cost-tool-button"
					aria-label={label}
					aria-pressed={pressed}
					onClick={onClick}
					disabled={disabled}
				>
					<Glyph size={16} />
					<span
						className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
						aria-hidden="true"
					/>
				</button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
const SAMPLE_LABELS: Partial<Record<CostDimension, readonly string[]>> = {
	members: ["you", "teammate", "reviewer"],
	models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
	repositories: ["you/app", "you/portfolio", "private/tmp"],
};
const SAMPLE_VALUES = [498.37, 6.67, 0.27];
const NO_TOGGLE = () => {};

function BreakdownSample({
	dimension,
	metric,
}: {
	dimension: CostDimension;
	metric: DashboardMetric;
}) {
	const labels = SAMPLE_LABELS[dimension] ?? ["Sample", "Sample row", "Other"];
	return labels.map((label, index) => (
		<BreakdownRow
			key={label}
			dimension={dimension}
			metric={metric}
			entry={{
				id: label,
				image: null,
				incomplete: false,
				label,
				value: SAMPLE_VALUES[index] ?? 0,
			}}
			maximum={SAMPLE_VALUES[0] ?? 1}
			color={SERIES_COLORS[index] ?? SERIES_COLORS[0]}
			selected={false}
			onToggle={NO_TOGGLE}
		/>
	));
}

/**
 * ScrollFade: a scrolling list with fades over the top edge once
 * scrolled and over the bottom while more rows are below.
 */
export function ScrollFade({
	className,
	children,
	...props
}: React.ComponentProps<"div">) {
	const viewport = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ top: false, bottom: false });
	const update = useCallback(() => {
		const element = viewport.current;
		if (!element) return;
		const top = element.scrollTop > 1;
		const bottom =
			element.scrollTop + element.clientHeight < element.scrollHeight - 1;
		setEdges((current) =>
			current.top === top && current.bottom === bottom
				? current
				: { top, bottom },
		);
	}, []);
	useLayoutEffect(() => {
		update();
		const element = content.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [update]);
	return (
		<div className="cost-scroll-fade">
			<div ref={viewport} onScroll={update} className={className} {...props}>
				<div ref={content}>{children}</div>
			</div>
			<div
				skullet-ignore=""
				className="cost-scroll-fade-edge"
				data-edge="top"
				data-visible={edges.top || undefined}
			/>
			<div
				skullet-ignore=""
				className="cost-scroll-fade-edge"
				data-edge="bottom"
				data-visible={edges.bottom || undefined}
			/>
		</div>
	);
}
function downloadBreakdown(
	dimension: CostDimension,
	entries: CostBreakdownEntry[],
	metric: DashboardMetric,
	valueLabel: string,
) {
	const cell = (value: string) =>
		`"${(/^[=+\-@\t\r]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
	const csv = [
		[
			COST_LABELS[dimension],
			metric === "cost" ? `${METRIC_LABELS.cost} (USD)` : valueLabel,
			...(metric === "cost" ? ["Partial estimate"] : []),
		],
		...entries.map((entry) => [
			costLabel(dimension, entry.label),
			metric === "cost"
				? entry.value.toFixed(6)
				: formatMetricRatio(entry.value, metric, entry.denominator),
			...(metric === "cost" ? [String(entry.incomplete)] : []),
		]),
	]
		.map((row) => row.map(cell).join(","))
		.join("\r\n");
	const url = URL.createObjectURL(
		new Blob([csv], { type: "text/csv;charset=utf-8" }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `opaline-${metric === "cost" ? "costs" : valueLabel.toLowerCase().replaceAll(" ", "-")}-${dimension}.csv`;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
