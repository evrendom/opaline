import { useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Reveal } from "@/app/ui/bones";
import { SearchInput } from "@/components/dashboard/data-table";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { DashboardModelBadges } from "@/features/dashboard/components/DashboardModelBadges";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { ToolbarSortMenu } from "@/features/sessions/components/sessions-overview-sort-menu";
import type {
	TeamPageMemberModelUsage,
	TeamPageMemberOverviewRow,
} from "@/features/team/use-team-page-data";
import {
	type UseFluidHoverReturn,
	useFluidHover,
	useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import {
	formatCompactWholeCurrency,
	formatCompactWholeNumber,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const lastActiveDateFormatter = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

const SPARKLINE_WIDTH = 128;
const SPARKLINE_HEIGHT = 28;
const SPARKLINE_PADDING = 2;
const MAX_VISIBLE_MODELS = 3;

type TeamTableSortKey =
	| "activity"
	| "cost"
	| "lastActive"
	| "name"
	| "sessions"
	| "tokens";
type TeamTableSortDirection = "asc" | "desc";

interface TeamTableSortState {
	direction: TeamTableSortDirection;
	key: TeamTableSortKey;
}

function getMemberInitials(displayName: string) {
	const nameParts = displayName
		.trim()
		.split(/\s+/u)
		.filter((part) => part.length > 0);

	if (nameParts.length === 0) {
		return "?";
	}

	const firstInitial = nameParts[0]?.at(0) ?? "";
	const lastInitial =
		nameParts.length > 1 ? (nameParts.at(-1)?.at(0) ?? "") : "";

	return `${firstInitial}${lastInitial}`.toLocaleUpperCase();
}

function formatLastActiveDate(lastActiveDate: string | null) {
	if (!lastActiveDate) {
		return "—";
	}

	const parsedDate = new Date(lastActiveDate);
	if (Number.isNaN(parsedDate.getTime())) {
		return lastActiveDate;
	}

	return lastActiveDateFormatter.format(parsedDate);
}

function buildSparklinePoints(values: readonly number[]) {
	const chartValues =
		values.length === 1 ? [values[0] ?? 0, values[0] ?? 0] : values;
	const maxValue = Math.max(...chartValues, 1);
	const drawableWidth = SPARKLINE_WIDTH - SPARKLINE_PADDING * 2;
	const drawableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;

	return chartValues
		.map((value, index) => {
			const x =
				SPARKLINE_PADDING +
				(index / Math.max(chartValues.length - 1, 1)) * drawableWidth;
			const y =
				SPARKLINE_HEIGHT -
				SPARKLINE_PADDING -
				(value / maxValue) * drawableHeight;

			return `${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(" ");
}

function ActivitySparkline({ values }: { values: readonly number[] }) {
	if (values.length === 0) {
		return <p className="text-base text-muted-foreground sm:text-sm">—</p>;
	}

	const totalSessions = values.reduce((total, value) => total + value, 0);

	return (
		<svg
			skullet-ignore=""
			aria-label={`${totalSessions.toLocaleString()} sessions across ${values.length.toLocaleString()} activity periods`}
			className="h-7 w-32 overflow-visible"
			role="img"
			viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
		>
			<polyline
				className="fill-none stroke-[#4D80E6]"
				points={buildSparklinePoints(values)}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

function getActivityTotal(row: TeamPageMemberOverviewRow) {
	return row.activityTrend.reduce((total, value) => total + value, 0);
}

function getNumericSortValue(
	row: TeamPageMemberOverviewRow,
	key: Exclude<TeamTableSortKey, "name">,
) {
	switch (key) {
		case "lastActive":
			return row.lastActiveDate ? Date.parse(row.lastActiveDate) || null : null;
		case "activity":
			return getActivityTotal(row);
		case "cost":
			return row.cost;
		case "sessions":
			return row.totalSessions;
		case "tokens":
			return row.totalTokens;
	}
}

export function sortTeamRows(
	rows: readonly TeamPageMemberOverviewRow[],
	sort: TeamTableSortState,
) {
	return [...rows].sort((leftRow, rightRow) => {
		if (sort.key === "name") {
			const order = leftRow.displayName.localeCompare(rightRow.displayName);
			return sort.direction === "asc" ? order : -order;
		}
		const leftValue = getNumericSortValue(leftRow, sort.key);
		const rightValue = getNumericSortValue(rightRow, sort.key);

		if (leftValue === null) {
			return rightValue === null
				? leftRow.displayName.localeCompare(rightRow.displayName)
				: 1;
		}
		if (rightValue === null) {
			return -1;
		}

		const valueDifference = leftValue - rightValue;
		return (
			(sort.direction === "asc" ? valueDifference : -valueDifference) ||
			leftRow.displayName.localeCompare(rightRow.displayName)
		);
	});
}

function ModelComposition({
	usage,
}: {
	usage: readonly TeamPageMemberModelUsage[];
}) {
	const sortedUsage = [...usage].sort(
		(leftModel, rightModel) =>
			rightModel.usageCount - leftModel.usageCount ||
			leftModel.model.localeCompare(rightModel.model),
	);
	const visibleModels = sortedUsage
		.slice(0, MAX_VISIBLE_MODELS)
		.map((modelUsage) => modelUsage.model);
	const hiddenModelCount = Math.max(
		sortedUsage.length - visibleModels.length,
		0,
	);
	const modelNames = sortedUsage
		.map((modelUsage) => formatModelDisplayLabel(modelUsage.model))
		.join(", ");

	return (
		<div
			className="flex min-w-0 items-center gap-1.5 overflow-hidden"
			title={modelNames || "No model activity"}
		>
			<DashboardModelBadges models={visibleModels} size="table" />
			{hiddenModelCount > 0 ? (
				<p className="shrink-0 text-base font-medium text-muted-foreground tabular-nums sm:text-sm">
					+{hiddenModelCount}
				</p>
			) : null}
		</div>
	);
}

// Two-line rows, as in the repos list: who over their role, then the
// metrics in fixed tracks with their units inline, so they line up without
// column headers (kept for screen readers).
const METRIC_CELL_CLASS_NAME =
	"h-16 px-3 py-0 text-right align-middle text-xs tabular-nums whitespace-nowrap text-(--session-overview-muted)";
const METRIC_UNIT_CLASS_NAME = "text-(--session-overview-subtle)";
const DAY_MS = 24 * 60 * 60 * 1000;

/** When a teammate was last active, by day (the roster keeps dates, not
 * times): "Today", "Yesterday", "3d ago", then months and years, with a green
 * dot through the week and a grey one after. */
export function LastActive({
	lastActiveDate,
}: {
	lastActiveDate: string | null;
}) {
	const parsed = lastActiveDate ? new Date(lastActiveDate) : null;
	if (!parsed || Number.isNaN(parsed.getTime()))
		return <span className={METRIC_UNIT_CLASS_NAME}>—</span>;
	const today = new Date();
	const days = Math.max(
		0,
		Math.round(
			(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
				Date.UTC(
					parsed.getUTCFullYear(),
					parsed.getUTCMonth(),
					parsed.getUTCDate(),
				)) /
				DAY_MS,
		),
	);
	const label =
		days === 0
			? "Today"
			: days === 1
				? "Yesterday"
				: days < 30
					? `${days}d ago`
					: days < 365
						? `${Math.floor(days / 30)}mo ago`
						: `${Math.floor(days / 365)}y ago`;
	return (
		<span
			className="inline-flex items-center gap-2"
			title={`Last active ${formatLastActiveDate(lastActiveDate)}`}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					days < 7 ? "bg-[#22c55e]" : "bg-black/20 dark:bg-white/25",
				)}
			/>
			<time dateTime={lastActiveDate ?? undefined}>{label}</time>
		</span>
	);
}

function TeamMemberRow({
	index,
	registerItem,
	row,
}: {
	index: number;
	registerItem: UseFluidHoverReturn["registerItem"];
	row: TeamPageMemberOverviewRow;
}) {
	const rowRef = useRef<HTMLTableRowElement>(null);
	useRegisterFluidHoverItem(registerItem, index, rowRef);
	return (
		<tr ref={rowRef} className="relative z-10 h-16">
			<td className="h-16 py-0 pr-3 pl-0 align-middle">
				<div className="flex min-w-0 items-center gap-3">
					<Avatar className="size-8 overflow-hidden bg-background outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10">
						{row.imageUrl ? <AvatarImage alt="" src={row.imageUrl} /> : null}
						<AvatarFallback className="bg-muted font-medium text-foreground">
							{getMemberInitials(row.displayName)}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<p className="truncate text-sm/5 font-medium text-(--session-overview-text)">
							{row.displayName}
						</p>
						<p className="truncate text-xs/4 text-(--session-overview-muted)">
							{row.role}
						</p>
					</div>
				</div>
			</td>
			<td className="h-16 px-3 py-0 align-middle">
				<ModelComposition usage={row.modelUsage} />
			</td>
			<td className="h-16 px-3 py-0 align-middle">
				<ActivitySparkline values={row.activityTrend} />
			</td>
			<td className={METRIC_CELL_CLASS_NAME}>
				<span>{formatCompactWholeNumber(row.totalSessions)}</span>
				<span className={METRIC_UNIT_CLASS_NAME}>
					{row.totalSessions === 1 ? " session" : " sessions"}
				</span>
			</td>
			<td
				className={METRIC_CELL_CLASS_NAME}
				title={`${row.totalTokens.toLocaleString()} tokens`}
			>
				<span>{formatCompactWholeNumber(row.totalTokens)}</span>
				<span className={METRIC_UNIT_CLASS_NAME}> tok</span>
			</td>
			<td
				className={cn(
					METRIC_CELL_CLASS_NAME,
					"font-medium text-(--session-overview-text)",
				)}
			>
				{formatCompactWholeCurrency(row.cost)}
			</td>
			<td className={cn(METRIC_CELL_CLASS_NAME, "pr-0 pl-3")}>
				<LastActive lastActiveDate={row.lastActiveDate} />
			</td>
		</tr>
	);
}

const SORT_OPTIONS = [
	{ key: "tokens", label: "Tokens" },
	{ key: "sessions", label: "Sessions" },
	{ key: "cost", label: "API cost" },
	{ key: "activity", label: "Activity" },
	{ key: "lastActive", label: "Last active" },
	{ key: "name", label: "Name" },
] as const satisfies readonly { key: TeamTableSortKey; label: string }[];

const COLUMN_LABELS = [
	"Teammate",
	"Model composition",
	"Activity",
	"Sessions",
	"Tokens used",
	"API cost",
	"Last active",
] as const;

const SAMPLE_ROWS: TeamPageMemberOverviewRow[] = [
	[
		"you",
		"Admin",
		2_000_000,
		818_000,
		51_000,
		["claude-opus-4-5", "gpt-5.1-codex", "gpt-5"],
	],
	["Alex Morgan", "Admin", 0, 0, 0, []],
	["Sam Lee", "Member", 0, 0, 0, []],
	["Jordan Patel", "Admin", 0, 0, 0, []],
	["Riley Chen", "Owner", 0, 0, 0, []],
	["Casey Brooks", "Owner", 0, 0, 0, []],
	["Taylor Kim", "Admin", 0, 0, 0, []],
	["Morgan Diaz", "Member", 0, 0, 0, []],
	["Jamie Fox", "Admin", 0, 0, 0, []],
].map(([displayName, role, totalTokens, inputTokens, cost, models], index) => ({
	activeDays: 0,
	activityTrend: [0, 0, 0, 0],
	cost: cost as number,
	displayName: displayName as string,
	email: null,
	favoriteModel: (models as string[])[0] ?? null,
	hasActivity: (totalTokens as number) > 0,
	imageUrl: null,
	inputTokens: inputTokens as number,
	lastActiveDate: (totalTokens as number) > 0 ? "2026-11-02" : null,
	modelUsage: (models as string[]).map((model) => ({ model, usageCount: 1 })),
	outputTokens: 0,
	role: role as string,
	totalSessions: 0,
	totalTokens: totalTokens as number,
	userId: `sample-${index}`,
}));

export function TeamMemberOverviewTable({
	loading = false,
	rows,
}: {
	loading?: boolean;
	rows: readonly TeamPageMemberOverviewRow[];
}) {
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<TeamTableSortState>({
		key: "tokens",
		direction: "desc",
	});
	const visibleRows = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return sortTeamRows(
			query
				? rows.filter((row) =>
						[row.displayName, row.email ?? "", row.role].some((value) =>
							value.toLocaleLowerCase().includes(query),
						),
					)
				: rows,
			sort,
		);
	}, [rows, search, sort]);

	return (
		<div className="-mx-2">
			<div className="flex h-12 items-center gap-2 px-2">
				<SearchInput
					value={search}
					onChange={setSearch}
					placeholder="Search teammates…"
				/>
				<ToolbarSortMenu
					noun="teammates"
					options={SORT_OPTIONS}
					activeSortLabel={
						SORT_OPTIONS.find((option) => option.key === sort.key)?.label ??
						"Tokens"
					}
					getInitialDirection={(key) => (key === "name" ? "asc" : "desc")}
					onSortChange={setSort}
					sort={sort}
				/>
			</div>
			<Reveal
				label="Loading teammates"
				loading={loading}
				sample={<MembersTable rows={SAMPLE_ROWS} />}
				sampleId="team-members"
			>
				{() => <MembersTable rows={visibleRows} />}
			</Reveal>
		</div>
	);
}

function MembersTable({
	rows,
}: {
	rows: readonly TeamPageMemberOverviewRow[];
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(containerRef, {
		axis: "y",
		gapClick: false,
		reflectActiveState: false,
	});
	return (
		<div className="overflow-x-auto whitespace-nowrap">
			<div
				ref={containerRef}
				className="relative isolate inline-block min-w-full align-middle"
				{...hover.handlers}
			>
				<FluidHoverHighlight
					hover={hover}
					className="z-0 rounded-none bg-(--session-overview-hover)"
				/>
				<table className="relative w-full min-w-240 border-collapse [&_tr>*:first-child]:pl-2 [&_tr>*:last-child]:pr-2">
					<colgroup>
						<col className="w-[24%]" />
						<col className="w-[21%]" />
						<col className="w-[16%]" />
						<col className="w-[9%]" />
						<col className="w-[10%]" />
						<col className="w-[9%]" />
						<col className="w-[11%]" />
					</colgroup>
					<thead className="sr-only">
						<tr>
							{COLUMN_LABELS.map((label) => (
								<th key={label} scope="col">
									{label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, index) => (
							<TeamMemberRow
								key={row.userId}
								index={index}
								registerItem={hover.registerItem}
								row={row}
							/>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
