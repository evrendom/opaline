import type { ReactNode } from "react";
import {
	type BenchmarkObservation,
	type BenchmarkSection,
	benchmarkGroups,
	benchmarkObservations,
	usageBenchmark,
} from "../../trends/trends-benchmarks";
import {
	formatCompact,
	formatDay,
	formatDecimal,
	formatDuration,
	formatInteger,
	formatMonth,
	formatPercent,
} from "../../trends/trends-format";
import type {
	TrendsBenchmarkModel,
	TrendsModel,
	TrendsReasoningEffort,
	TrendsSnapshot,
} from "../../trends/trends-snapshot";
import { Movement, ProviderMark } from "./trends-marks";
import { rankMovements } from "./trends-movement";
import { buildShareSeries, type ShareModel } from "./trends-plot-charts";
import {
	measuredPushback,
	rangeQuantiles,
	rankedValue,
	sharePeriods,
	type TrendsSection,
} from "./trends-sections";

interface Column<Row> {
	readonly label: string;
	readonly numeric?: boolean;
	readonly cell: (row: Row) => ReactNode;
}

function DataTable<Row>({
	caption,
	columns,
	rows,
	rowKey,
	rowDimmed,
	footnote,
}: {
	readonly caption: string;
	readonly columns: readonly Column<Row>[];
	readonly rows: readonly Row[];
	readonly rowKey: (row: Row) => string;
	/** Rows that stand back, as their model does in the legend. */
	readonly rowDimmed?: (row: Row) => boolean;
	/** A note under the table, e.g. what an asterisk marks. */
	readonly footnote?: string;
}) {
	return (
		<>
			<div className="trends-table-scroll">
				<table className="trends-table">
					<caption className="visually-hidden">{caption}</caption>
					<thead>
						<tr>
							{columns.map((column) => (
								<th
									key={column.label}
									scope="col"
									data-numeric={column.numeric ?? false}
								>
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={rowKey(row)} data-dimmed={rowDimmed?.(row) || undefined}>
								{columns.map((column, index) =>
									index === 0 ? (
										<th key={column.label} scope="row">
											{column.cell(row)}
										</th>
									) : (
										<td
											key={column.label}
											data-numeric={column.numeric ?? false}
										>
											{column.cell(row)}
										</td>
									),
								)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{footnote ? <p className="trends-table-footnote">{footnote}</p> : null}
		</>
	);
}

const modelColumn: Column<TrendsModel> = {
	label: "Model",
	cell: (model) => (
		<span className="trends-table-model">
			<ProviderMark provider={model.provider} />
			{model.name}
		</span>
	),
};

const runsColumn: Column<TrendsModel> = {
	label: "Agent runs",
	numeric: true,
	cell: (model) => formatCompact(model.runs),
};

const sessionsColumn: Column<TrendsModel> = {
	label: "Sessions",
	numeric: true,
	cell: (model) =>
		model.sessions === undefined ? "–" : formatCompact(model.sessions),
};

const developersColumn: Column<TrendsModel> = {
	label: "Developers",
	numeric: true,
	cell: (model) => formatInteger(model.developers),
};

export function BenchmarkTable({
	section,
	models,
	efforts,
	dimmedIds,
}: {
	readonly section: BenchmarkSection;
	readonly models: readonly TrendsBenchmarkModel[];
	readonly efforts: ReadonlySet<TrendsReasoningEffort>;
	/** Models faded in the legend (off the chart, or off the frontier): their
	 * rows follow the others, faded the same way. */
	readonly dimmedIds?: ReadonlySet<string>;
}) {
	const dimmed = (row: BenchmarkObservation) =>
		dimmedIds?.has(row.model.id) ?? false;
	const ordered = benchmarkGroups(
		benchmarkObservations(models, section.metric, efforts),
	).flatMap((group) => group.rows);
	const rows = [
		...ordered.filter((row) => !dimmed(row)),
		...ordered.filter(dimmed),
	];
	const columns: readonly Column<BenchmarkObservation>[] = [
		{
			label: "Model",
			cell: (row) => (
				<a
					className="trends-table-model trends-table-link"
					href={row.point.sourceUrl}
					target="_blank"
					rel="noreferrer"
				>
					<ProviderMark provider={row.model.provider} />
					{row.model.name}
				</a>
			),
		},
		{ label: "Reasoning", cell: (row) => row.point.effortLabel },
		{
			label: "Source",
			cell: (row) => (
				<a
					className="trends-table-link"
					href={row.point.sourceUrl}
					target="_blank"
					rel="noreferrer"
				>
					View source ↗
				</a>
			),
		},
		{
			label: section.unit,
			numeric: true,
			cell: (row) => section.format(row.value),
		},
		{
			label: "Intelligence index",
			numeric: true,
			cell: (row) =>
				row.point.intelligenceIndex === null
					? "—"
					: formatDecimal(row.point.intelligenceIndex),
		},
	];
	return rows.length > 0 ? (
		<DataTable
			caption={`${section.tab}, by model and reasoning effort`}
			rows={rows}
			columns={columns}
			rowKey={(row) => `${row.model.id}-${row.point.effort}`}
			rowDimmed={dimmed}
		/>
	) : (
		<p className="trends-empty">
			No observations for these models and reasoning efforts.
		</p>
	);
}

/** One of friction's bars: a model, its figure, and whether that rests on
 * too little to rank (named with an asterisk). */
export interface FrictionTableRow {
	readonly id: string;
	readonly name: string;
	readonly provider: TrendsModel["provider"];
	readonly value: number;
	readonly thin: boolean;
}

/**
 * Friction's table: exactly the chart's bars, highest first, with each
 * published model's usage beside it ("–" for a model not yet published).
 * The note under it says what the asterisk marks, while one is listed.
 */
export function FrictionTable({
	unit,
	format,
	rows,
	models,
	thinNote,
}: {
	readonly unit: string;
	readonly format: (value: number) => string;
	readonly rows: readonly FrictionTableRow[];
	readonly models: readonly TrendsModel[];
	readonly thinNote: string;
}) {
	const usage = new Map(models.map((model) => [model.id, model]));
	const fromUsage = (
		label: string,
		cell: (model: TrendsModel) => ReactNode,
	): Column<FrictionTableRow> => ({
		label,
		numeric: true,
		cell: (row) => {
			const model = usage.get(row.id);
			return model ? cell(model) : "–";
		},
	});
	return (
		<DataTable
			caption={unit}
			rows={[...rows].sort((first, second) => second.value - first.value)}
			rowKey={(row) => row.id}
			footnote={rows.some((row) => row.thin) ? thinNote : undefined}
			columns={[
				{
					label: "Model",
					cell: (row) => (
						<span className="trends-table-model">
							<ProviderMark provider={row.provider} />
							{row.thin ? `${row.name}*` : row.name}
						</span>
					),
				},
				{ label: unit, numeric: true, cell: (row) => format(row.value) },
				fromUsage("Agent runs", (model) => formatCompact(model.runs)),
				fromUsage("Sessions", (model) =>
					model.sessions === undefined ? "–" : formatCompact(model.sessions),
				),
				fromUsage("Developers", (model) => formatInteger(model.developers)),
			]}
		/>
	);
}

export function TrendsTable({
	section,
	snapshot,
	models,
	shareModels,
}: {
	readonly section: TrendsSection;
	readonly snapshot: TrendsSnapshot;
	readonly models: readonly TrendsModel[];
	/** The share's models: every selected model, with usage data or not. */
	readonly shareModels?: readonly ShareModel[];
}) {
	const movements = rankMovements(section, models);
	// All time has no prior period: no change to show.
	const withChange = snapshot.usageScope !== "all_time";
	const changeColumn: Column<TrendsModel> = {
		label: "Change",
		cell: (model) => <Movement movement={movements.get(model.id)} />,
	};
	switch (section.kind) {
		case "ranked":
			return (
				<DataTable
					caption={section.unit}
					rows={[...models].sort(
						(a, b) => rankedValue(section, b) - rankedValue(section, a),
					)}
					rowKey={(model) => model.id}
					columns={[
						modelColumn,
						...(withChange ? [changeColumn] : []),
						{
							label: section.unit,
							numeric: true,
							cell: (model) => section.format(rankedValue(section, model)),
						},
						...(section.detail
							? [{ label: "Note", cell: section.detail }]
							: []),
						runsColumn,
						sessionsColumn,
						developersColumn,
					]}
				/>
			);
		case "range": {
			const hasP99 = models.some(
				(model) => rangeQuantiles(section, model).p99 !== undefined,
			);
			return (
				<DataTable
					caption={section.unit}
					rows={[...models].sort(
						(a, b) =>
							rangeQuantiles(section, b).p50 - rangeQuantiles(section, a).p50,
					)}
					rowKey={(model) => model.id}
					columns={[
						modelColumn,
						...(withChange ? [changeColumn] : []),
						{
							label: "Median",
							numeric: true,
							cell: (model) =>
								section.format(rangeQuantiles(section, model).p50),
						},
						{
							label: "p90",
							numeric: true,
							cell: (model) =>
								section.format(rangeQuantiles(section, model).p90),
						},
						...(hasP99
							? [
									{
										label: "p99",
										numeric: true,
										cell: (model: TrendsModel) => {
											const { p99 } = rangeQuantiles(section, model);
											return p99 === undefined ? "–" : section.format(p99);
										},
									},
								]
							: []),
						runsColumn,
						sessionsColumn,
					]}
				/>
			);
		}
		case "share": {
			const volume = section.measure === "volume";
			const series = buildShareSeries(
				snapshot,
				shareModels ?? models,
				undefined,
				volume,
			);
			const { kind, periods } = sharePeriods(snapshot);
			return (
				<DataTable
					caption={section.unit}
					rows={periods.map((period, index) => ({ period, index }))}
					rowKey={(row) => row.period.start}
					columns={[
						{
							label: kind === "week" ? "Week of" : "Day",
							cell: (row) => formatDay(row.period.start),
						},
						...series.map((entry) => ({
							label: entry.name,
							numeric: true,
							cell: (row: { index: number }) =>
								(volume ? formatCompact : formatPercent)(
									entry.values[row.index] ?? 0,
								),
						})),
					]}
				/>
			);
		}
		case "harness":
			return null;
		case "timeline": {
			const runTime = section.metric === "runTime";
			const rows = runTime
				? (snapshot.runTimeMonths ?? []).map((month) => ({
						monthStart: month.monthStart,
						runs: month.runs,
						mean: month.meanSeconds,
						p95: month.p95Seconds,
						p99: month.p99Seconds,
					}))
				: (snapshot.toolCallMonths ?? []).map((month) => ({
						monthStart: month.monthStart,
						runs: month.runs,
						mean: month.meanCalls,
						p95: month.p95Calls,
						p99: month.p99Calls,
					}));
			const format = runTime
				? formatDuration
				: (value: number) => formatDecimal(value);
			return (
				<DataTable
					caption={section.unit}
					rows={rows}
					rowKey={(month) => month.monthStart}
					columns={[
						{ label: "Month", cell: (month) => formatMonth(month.monthStart) },
						{
							label: "Agent runs",
							numeric: true,
							cell: (month) => formatCompact(month.runs),
						},
						{
							label: "Average",
							numeric: true,
							cell: (month) => format(month.mean),
						},
						{ label: "p95", numeric: true, cell: (month) => format(month.p95) },
						{ label: "p99", numeric: true, cell: (month) => format(month.p99) },
					]}
				/>
			);
		}
		case "scatter":
			return (
				<DataTable
					caption={section.unit}
					rows={models}
					rowKey={(model) => model.id}
					columns={[
						modelColumn,
						{
							label: "Intelligence Index",
							numeric: true,
							cell: (model) => {
								const point = usageBenchmark(model, snapshot);
								return point?.intelligenceIndex != null
									? formatDecimal(point.intelligenceIndex)
									: "—";
							},
						},
						{ label: "Reasoning", cell: (model) => model.benchmarkEffort },
						{
							label: "Source",
							cell: (model) => {
								const point = usageBenchmark(model, snapshot);
								return point ? (
									<a
										className="trends-table-link"
										href={point.sourceUrl}
										target="_blank"
										rel="noreferrer"
									>
										View source ↗
									</a>
								) : (
									"—"
								);
							},
						},
						{
							label: "Pushback",
							numeric: true,
							cell: (model) => formatPercent(measuredPushback(model)),
						},
						runsColumn,
						sessionsColumn,
					]}
				/>
			);
	}
}
