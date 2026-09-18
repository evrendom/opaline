import {
	ArrowExpand01Icon,
	GitBranchIcon,
	GitForkIcon,
	Message01Icon,
	MoreHorizontalIcon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
	CostBreakdownEntry,
	CostDimension,
	DashboardMetric,
} from "@rudel/api-routes";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/app/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/app/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import { getModelBadgeTone } from "@/features/dashboard/components/dashboard-model-brand";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { costLabel, formatMetric, METRIC_LABELS } from "./cost-format";
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
};

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
}: Props) {
	const [expanded, setExpanded] = useState(false);
	const [search, setSearch] = useState("");
	const [menuOpen, setMenuOpen] = useState(false);
	const label = COST_LABELS[dimension];
	const countLabel =
		dimension === "durations"
			? "ranges"
			: dimension === "runSignals" || dimension === "skillsUsed"
				? "options"
				: dimension === "phrases"
					? "phrases"
					: label.toLowerCase();
	const total = entries.reduce((sum, row) => sum + row.value, 0);
	const maximum = Math.max(0, ...entries.map((entry) => entry.value));
	const filtered = entries.filter((entry) =>
		`${entry.id} ${costLabel(dimension, entry.label)}`
			.toLowerCase()
			.includes(search.toLowerCase()),
	);
	return (
		<>
			<section
				className="cost-breakdown"
				data-dimension={dimension}
				aria-label={label}
				aria-busy={pending}
			>
				<div className="cost-breakdown-heading">
					<h2
						title={
							dimension === "runSignals"
								? "Signal in the immediately following user reply. No signal means a reply without detected positive or negative feedback; No reply means no following user message."
								: dimension === "durations"
									? "Elapsed time from user prompt to final assistant message, including waits. Unknown duration is counted separately."
									: dimension === "skillsUsed"
										? "Whether the run contains a recorded skill invocation."
										: undefined
						}
					>
						{label}
					</h2>
					<div>
						{metric === "cost" ? (
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
				<div className="cost-breakdown-list" data-fluid-menu-root="">
					<FluidMenuHover items=".cost-breakdown-row" />
					{pending ? (
						<BreakdownSkeleton />
					) : entries.length ? (
						entries
							.slice(0, dimension === "durations" ? entries.length : 7)
							.map((entry) => (
								<BreakdownRow
									key={entry.id}
									dimension={dimension}
									metric={metric}
									entry={entry}
									maximum={maximum}
									total={total}
									selected={selected.includes(entry.id)}
									onToggle={onToggle}
								/>
							))
					) : (
						<p className="cost-breakdown-empty">
							{unavailable
								? "Still being indexed…"
								: `No matching ${label.toLowerCase()}.`}
						</p>
					)}
				</div>
				<div className="cost-breakdown-footer">
					<span>
						{pending
							? ""
							: `${entries.length} ${entries.length === 1 ? (dimension === "repositories" ? "repository" : countLabel.slice(0, -1)) : countLabel}`}
					</span>
					<span>{selected.length ? `${selected.length} selected` : ""}</span>
				</div>
				<div className="cost-tools" data-open={menuOpen || split}>
					<div className="cost-tools-inner" data-fluid-menu-root="">
						<FluidMenuHover items=".cost-tool-button" />
						<ToolButton
							label={`View all ${label.toLowerCase()}`}
							icon={ArrowExpand01Icon}
							onClick={() => {
								setSearch("");
								setExpanded(true);
							}}
							disabled={pending || unavailable}
						/>
						<ToolButton
							label={split ? "Show total" : `Split by ${label.toLowerCase()}`}
							icon={GitForkIcon}
							onClick={onSplit}
							pressed={split}
							disabled={pending || unavailable}
						/>
						<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
							<DropdownMenuTrigger
								render={
									<button
										type="button"
										className="cost-tool-button"
										aria-label={`More ${label.toLowerCase()} tools`}
									/>
								}
							>
								<HugeiconsIcon
									icon={MoreHorizontalIcon}
									size={16}
									strokeWidth={1.5}
								/>
							</DropdownMenuTrigger>
							<DropdownMenuContent side="top" align="center" sideOffset={10}>
								<DropdownMenuItem
									onClick={() =>
										downloadBreakdown(dimension, entries, metric, valueLabel)
									}
									disabled={pending || entries.length === 0}
								>
									Download breakdown
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={onClear}
									disabled={selected.length === 0}
								>
									Clear {label.toLowerCase()} filter
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</section>
			<Dialog open={expanded} onOpenChange={setExpanded}>
				<DialogContent className="cost-breakdown-dialog gap-4 rounded-xl sm:max-w-xl dark:shadow-none">
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
						{pending ? (
							<BreakdownSkeleton />
						) : (
							filtered.map((entry) => (
								<BreakdownRow
									key={entry.id}
									dimension={dimension}
									metric={metric}
									entry={entry}
									maximum={maximum}
									total={total}
									selected={selected.includes(entry.id)}
									onToggle={onToggle}
								/>
							))
						)}
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

function BreakdownRow({
	entry,
	metric,
	dimension,
	total,
	maximum,
	selected,
	onToggle,
}: {
	entry: CostBreakdownEntry;
	metric: DashboardMetric;
	dimension: CostDimension;
	total: number;
	maximum: number;
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
			title={`${label} · ${formatMetric(entry.value, metric)}`}
		>
			<span
				className="cost-row-bar"
				style={{ width: `${maximum > 0 ? (entry.value / maximum) * 100 : 0}%` }}
				aria-hidden="true"
			/>
			<span className="cost-row-identity">
				<EntryIcon dimension={dimension} entry={entry} />
				<span className="truncate">{label}</span>
				{selected ? (
					<HugeiconsIcon icon={Tick02Icon} size={14} className="shrink-0" />
				) : null}
			</span>
			<span className="cost-row-amount">
				{formatMetric(entry.value, metric)}
			</span>
			<span className="cost-row-share">
				{total > 0
					? entry.value > 0 && entry.value / total < 0.01
						? "<1%"
						: `${Math.round((entry.value / total) * 100)}%`
					: "—"}
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
				width={22}
				height={22}
				className="size-5.5 shrink-0 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10"
			/>
		);
	if (dimension === "members")
		return (
			<Avatar className="size-5.5 shrink-0 rounded-full ring-1 ring-black/5 dark:ring-white/10">
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
		return (
			<HugeiconsIcon
				icon={GitBranchIcon}
				size={16}
				className="shrink-0"
				strokeWidth={1.5}
			/>
		);
	if (dimension === "signalTypes" || dimension === "phrases")
		return (
			<HugeiconsIcon
				icon={Message01Icon}
				size={16}
				className="shrink-0"
				strokeWidth={1.5}
			/>
		);
	if (dimension !== "models") return null;
	const tone = getModelBadgeTone(entry.id);
	if (tone.icon === "claude")
		return <ClaudeModelIcon className="size-4 shrink-0" />;
	if (tone.icon === "codex")
		return <CodexModelIcon className="size-4 shrink-0" />;
	return (
		<span className="cost-unknown-model" aria-hidden="true">
			?
		</span>
	);
}

function ToolButton({
	label,
	icon,
	onClick,
	disabled,
	pressed,
}: {
	label: string;
	icon: typeof ArrowExpand01Icon;
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
					<HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
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
function BreakdownSkeleton() {
	return (
		<div className="cost-breakdown-skeleton" aria-hidden="true">
			{[80, 64, 72, 48, 60].map((width, index) => (
				<div key={width}>
					<div className="cost-skeleton size-5 rounded-full" />
					<div
						className="cost-skeleton h-3"
						style={{ width: `${width - index * 3}%` }}
					/>
					<div className="cost-skeleton h-3 w-10" />
				</div>
			))}
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
			metric === "cost" ? entry.value.toFixed(6) : String(entry.value),
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
