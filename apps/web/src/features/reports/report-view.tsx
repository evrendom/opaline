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
import { type HealthBlock, splitHealthBlock } from "./health-block";
import { dataWindow, formatDay } from "./report-dates";

type Report = AnalysisHistoryReportOutput;
type ReportResult = Report["results"][number];

const MARKDOWN_CLASS_NAME =
	"leading-relaxed [overflow-wrap:anywhere] [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.8125rem] [&_h1]:mt-4 [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";
const REMARK_PLUGINS = [remarkGfm];

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
		<main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10 text-sm text-foreground">
			<header className="flex flex-col gap-2">
				<p className="text-xs text-muted-foreground">Saved analysis</p>
				<h1 className="text-xl font-medium text-balance">{report.question}</h1>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
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

			<section aria-labelledby="report-answer" className="flex flex-col gap-2">
				<h2 id="report-answer" className="text-base font-medium">
					Answer
				</h2>
				{markdown ? (
					<div className={MARKDOWN_CLASS_NAME}>
						<Markdown remarkPlugins={REMARK_PLUGINS}>{markdown}</Markdown>
					</div>
				) : (
					<p className="text-muted-foreground">No final answer was saved.</p>
				)}
			</section>

			{health ? <HealthSection health={health} /> : null}

			<section
				aria-labelledby="report-findings"
				className="flex flex-col gap-2"
			>
				<h2 id="report-findings" className="text-base font-medium">
					Findings
				</h2>
				{findings.length ? (
					<ol className="flex list-decimal flex-col gap-3 pl-5">
						{findings.map((step) => (
							<li key={step.id} className="pl-1">
								<p>{step.finding}</p>
								<CitedRuns
									runs={citedRuns.get(step.id) ?? []}
									workspaceSlug={workspaceSlug}
								/>
							</li>
						))}
					</ol>
				) : (
					<p className="text-muted-foreground">No findings were saved.</p>
				)}
			</section>

			<section aria-labelledby="report-steps" className="flex flex-col gap-3">
				<h2 id="report-steps" className="text-base font-medium">
					Steps
				</h2>
				{report.steps.length ? (
					<ol className="flex flex-col gap-4">
						{report.steps.map((step) => (
							<li key={step.id} className="flex flex-col gap-2">
								<p className="font-mono text-xs">{step.question}</p>
								{step.queries.map((query) => {
									const result = results.get(query.id);
									return result ? (
										<ResultTable key={query.id} result={result} />
									) : (
										<p
											key={query.id}
											className="font-mono text-xs text-muted-foreground"
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
					<p className="text-muted-foreground">No steps were recorded.</p>
				)}
			</section>
		</main>
	);
}

function HealthSection({ health }: { health: HealthBlock }) {
	return (
		<section aria-labelledby="report-health" className="flex flex-col gap-3">
			<h2 id="report-health" className="text-base font-medium">
				Health
			</h2>
			{health.summary ? <p>{health.summary}</p> : null}
			{health.actions.length ? (
				<div className="flex flex-col gap-1">
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
				<div className="flex flex-col gap-1">
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
		<p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
			<span>Runs:</span>
			{runs.map((run) => (
				<Link
					key={`${run.sessionId}-${run.agentId}-${run.turn}`}
					className="font-mono underline underline-offset-2 hover:text-foreground"
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
		<div className="flex flex-col gap-1 rounded-md border border-border/60 p-2">
			<p className="text-xs text-muted-foreground">
				{result.title}
				{result.truncated ? " (cut)" : ""}
			</p>
			{result.rows.length ? (
				<Table>
					<TableHeader>
						<TableRow>
							{result.columns.map((column) => (
								<TableHead key={column} className="font-mono text-xs">
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
										className="font-mono text-xs"
									>
										{cell}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			) : (
				<p className="text-xs text-muted-foreground">No rows.</p>
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
