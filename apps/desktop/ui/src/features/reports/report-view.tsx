import type { AnalysisHistoryReportOutput, RunRef } from "@rudel/api-routes";
import Markdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { appRoutes, getWorkspaceAppPath } from "@/app/routes";
import { Badge } from "@/app/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/app/ui/table";
import { remarkAppLinks } from "@/features/desktop/app-link-markdown";
import { type HealthBlock, splitHealthBlock } from "./health-block";
import { dataWindow, formatDay } from "./report-dates";

type Report = AnalysisHistoryReportOutput;
type ReportResult = Report["results"][number];

const MARKDOWN_CLASS_NAME =
	"[overflow-wrap:anywhere] [&_a]:underline [&_code]:corner-xs [&_code]:bg-field [&_code]:px-xs [&_code]:font-data [&_code]:text-body-l [&_h1]:mt-xl [&_h1]:font-heavy [&_h2]:mt-xl [&_h2]:font-heavy [&_h3]:mt-l [&_h3]:font-heavy [&_li]:my-xxs [&_ol]:my-m [&_ol]:list-decimal [&_ol]:pl-xxl [&_p]:my-m [&_pre]:my-m [&_pre]:overflow-x-auto [&_pre]:corner-s [&_pre]:bg-field [&_pre]:p-l [&_pre_code]:bg-transparent [&_pre_code]:p-zero [&_table]:my-m [&_td]:edge-m [&_td]:px-m [&_td]:py-xs [&_th]:edge-m [&_th]:px-m [&_th]:py-xs [&_ul]:my-m [&_ul]:list-disc [&_ul]:pl-xxl [&>*:first-child]:mt-zero [&>*:last-child]:mb-zero";
const REMARK_PLUGINS = [remarkGfm, remarkAppLinks];

export function ReportView({
	report,
	authorName,
	workspaceSlug,
}: {
	report: Report;
	authorName: string | null;
	workspaceSlug: string;
}) {
	const { markdown, health } = splitHealthBlock(report.finalAnswer ?? "");
	const results = new Map(
		report.results.map((result) => [result.query, result]),
	);
	const citedRuns = new Map(
		report.citedRuns.map((cited) => [cited.step, cited.runs]),
	);
	const findings = report.steps.filter((step) => step.finding);
	return (
		<main
			data-selectable=""
			className="mx-auto flex w-full max-w-3xl flex-col gap-[calc(var(--space-xxl)*4/3)] px-xxl py-[calc(var(--space-xxl)*5/3)] text-body-xl text-ink"
		>
			<header className="flex flex-col gap-m">
				<p className="text-body-m text-ink-3">Saved analysis</p>
				<h1 className="text-display-xxs font-medium text-balance">
					{report.question}
				</h1>
				<div className="flex flex-wrap items-center gap-x-m gap-y-xs text-ink-3">
					<span>
						Saved {formatDay(report.createdAt)}
						{authorName ? ` by ${authorName}` : ""}
					</span>
					<span aria-hidden="true">·</span>
					<span>{dataWindow(report)}</span>
					<Badge variant={report.shared ? "secondary" : "outline"}>
						{report.shared ? "Shared with workspace" : "Not shared"}
					</Badge>
				</div>
			</header>

			<section aria-labelledby="report-answer" className="flex flex-col gap-m">
				<h2 id="report-answer" className="text-body-xxl font-medium">
					Answer
				</h2>
				{markdown ? (
					<div className={MARKDOWN_CLASS_NAME}>
						<Markdown remarkPlugins={REMARK_PLUGINS}>{markdown}</Markdown>
					</div>
				) : (
					<p className="text-ink-3">No final answer was saved.</p>
				)}
			</section>

			{health ? <HealthSection health={health} /> : null}

			<section
				aria-labelledby="report-findings"
				className="flex flex-col gap-m"
			>
				<h2 id="report-findings" className="text-body-xxl font-medium">
					Findings
				</h2>
				{findings.length ? (
					<ol className="flex list-decimal flex-col gap-l pl-xxl">
						{findings.map((step) => (
							<li key={step.id} className="pl-xs">
								<p>{step.finding}</p>
								<CitedRuns
									runs={citedRuns.get(step.id) ?? []}
									workspaceSlug={workspaceSlug}
								/>
							</li>
						))}
					</ol>
				) : (
					<p className="text-ink-3">No findings were saved.</p>
				)}
			</section>

			<section aria-labelledby="report-steps" className="flex flex-col gap-l">
				<h2 id="report-steps" className="text-body-xxl font-medium">
					Steps
				</h2>
				{report.steps.length ? (
					<ol className="flex flex-col gap-xl">
						{report.steps.map((step) => (
							<li key={step.id} className="flex flex-col gap-m">
								<p className="font-data text-body-m">{step.question}</p>
								{step.queries.map((query) => {
									const result = results.get(query.id);
									return result ? (
										<ResultTable key={query.id} result={result} />
									) : (
										<p
											key={query.id}
											className="font-data text-body-m text-ink-3"
										>
											{query.id}
											{query.unavailable ? ` (${query.unavailable})` : ""}
										</p>
									);
								})}
							</li>
						))}
					</ol>
				) : (
					<p className="text-ink-3">No steps were recorded.</p>
				)}
			</section>
		</main>
	);
}

function HealthSection({ health }: { health: HealthBlock }) {
	return (
		<section aria-labelledby="report-health" className="flex flex-col gap-l">
			<h2 id="report-health" className="text-body-xxl font-medium">
				Health
			</h2>
			{health.summary ? <p>{health.summary}</p> : null}
			{health.actions.length ? (
				<div className="flex flex-col gap-xs">
					<h3 className="font-medium">Actions</h3>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Action</TableHead>
								<TableHead>Why</TableHead>
								<TableHead>Impact</TableHead>
								<TableHead>Effort</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{health.actions.map((action) => (
								<TableRow key={`${action.rank}-${action.title}`}>
									<TableCell className="whitespace-normal font-medium">
										{action.title}
									</TableCell>
									<TableCell className="whitespace-normal">
										{action.why}
									</TableCell>
									<TableCell>{action.impact}</TableCell>
									<TableCell>{action.effort}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			) : null}
			{health.signals.length ? (
				<div className="flex flex-col gap-xs">
					<h3 className="font-medium">Signals</h3>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Signal</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{health.signals.map((signal) => (
								<TableRow key={`${signal.area}-${signal.label}`}>
									<TableCell className="whitespace-normal">
										{signal.label}
									</TableCell>
									<TableCell>{signal.status}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			) : null}
		</section>
	);
}

function CitedRuns({
	runs,
	workspaceSlug,
}: {
	runs: readonly RunRef[];
	workspaceSlug: string;
}) {
	if (!runs.length) return null;
	return (
		<p className="mt-xs flex flex-wrap gap-x-l gap-y-xs text-body-m text-ink-3">
			<span>Runs:</span>
			{runs.map((run) => (
				<Link
					key={`${run.sessionId}-${run.agentId}-${run.turn}`}
					className="font-data underline underline-offset-2 hover:text-ink"
					to={getWorkspaceAppPath(
						workspaceSlug,
						appRoutes.sessionDetail(run.sessionId),
					)}
				>
					{run.sessionId.slice(0, 8)}
					{run.agentId ? ` ${run.agentId.slice(0, 8)}` : ""} turn {run.turn}
				</Link>
			))}
		</p>
	);
}

function ResultTable({ result }: { result: ReportResult }) {
	return (
		<div className="flex flex-col gap-xs corner-s edge-m border-line/60 p-m">
			<p className="text-body-m text-ink-3">
				{result.title}
				{result.truncated ? " (cut)" : ""}
			</p>
			{result.rows.length ? (
				<Table>
					<TableHeader>
						<TableRow>
							{result.columns.map((column) => (
								<TableHead key={column} className="font-data text-body-m">
									{column}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{keyedRows(result.rows).map(({ key, row }) => (
							<TableRow key={key}>
								{row.map((cell, cellIndex) => (
									<TableCell
										key={`${result.columns[cellIndex] ?? cellIndex}`}
										className="font-data text-body-m"
									>
										{cell}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			) : (
				<p className="text-body-m text-ink-3">No rows.</p>
			)}
		</div>
	);
}

function keyedRows<T>(rows: readonly T[]): { key: string; row: T }[] {
	const seen = new Map<string, number>();
	return rows.map((row) => {
		const content = JSON.stringify(row);
		const count = (seen.get(content) ?? 0) + 1;
		seen.set(content, count);
		return { key: `${content}#${count}`, row };
	});
}
