import type { ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Bone, Bones } from "@/app/ui/bones";
import { ProductLoadingIndicator } from "@/features/shell/product-loading-screen";
import { cn } from "@/lib/utils";
import { ContextMapSample } from "./context/session-reader-context-map-sample";
import { READING_MEASURE } from "./detail/reading-measure";
import {
	readSessionReaderTab,
	SESSION_TAB_PARAM,
	type SessionReaderTab,
} from "./reader-params";
import { SummarySection } from "./summary/session-reader-summary-section";

const MEMBER_PARAGRAPHS = [
	"The sessions page takes a few seconds to show anything when it opens, and scrolling the detail stutters once a session has a lot of turns.",
	"Can you find out where the time goes, from the query to the first paint, and make the page fast?",
	"Measure before and after so we know what helped.",
];

function MemberSample() {
	return (
		<div className="flex gap-3">
			<Bone className="mt-1.5 size-6 shrink-0 rounded-full" />
			<div className="flex min-w-0 flex-1 flex-col gap-5 rounded-lg bg-card px-3 py-2.5 text-sm shadow-(--custom-shadow) corner-squircle squircle:rounded-2xl">
				{MEMBER_PARAGRAPHS.map((paragraph) => (
					<p key={paragraph}>{paragraph}</p>
				))}
			</div>
		</div>
	);
}

function TurnSample({ trace = false }: { trace?: boolean }) {
	return (
		<div className="flex w-full flex-col gap-8 text-sm">
			<div className={cn("flex flex-col gap-2", READING_MEASURE)}>
				<div className="flex flex-wrap items-center gap-2 pl-9 text-xs">
					<span className="font-medium">you</span>
					<span className="tabular-nums">Oct 22, 08:48</span>
					<span className="tabular-nums">~8K tokens · 0.8%</span>
				</div>
				<MemberSample />
			</div>
			<div className="relative flex flex-col gap-4">
				<div className={cn("flex gap-3", READING_MEASURE)}>
					<Bone className="size-6 shrink-0 rounded-full" />
					<div className="min-w-0 flex-1">
						<div className="flex flex-col gap-2 px-1 pt-1">
							<Bone className="h-3.5 w-full rounded-sm" />
							<Bone className="h-3.5 w-11/12 rounded-sm" />
							<Bone className="h-3.5 w-2/3 rounded-sm" />
						</div>
					</div>
				</div>
				{trace ? <TraceSample /> : null}
			</div>
		</div>
	);
}

const TRACE_ROWS = [
	{ id: "a", label: 64, left: 0, width: 12 },
	{ id: "b", label: 32, left: 13, width: 3 },
	{ id: "c", label: 64, left: 16, width: 14 },
	{ id: "d", label: 56, left: 31, width: 2 },
	{ id: "e", label: 64, left: 34, width: 16 },
];
const CARD_FIGURES = ["time", "cost", "tokens", "steps"];
const CARD_LANES = [
	{ id: "a", bars: [0, 9, 17, 30, 44, 58, 70, 86] },
	{ id: "b", bars: [8, 26, 58] },
	{ id: "c", bars: [12, 50] },
	{ id: "d", bars: [6, 40, 64] },
	{ id: "e", bars: [22, 36] },
];

function TraceSample() {
	return (
		<div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_3.5rem_var(--reader-card)]">
			<div className="flex min-w-0 flex-col gap-5 pl-9 pt-2">
				{TRACE_ROWS.map((row) => (
					<div key={row.id} className="flex h-6 items-center gap-2">
						<Bone className="size-5 shrink-0 rounded-md" />
						<Bone
							className="h-3 shrink-0 rounded-sm"
							style={{ width: row.label }}
						/>
						<div className="relative h-3 min-w-0 flex-1">
							<Bone
								className="absolute inset-y-0 rounded-sm"
								style={{ left: `${row.left}%`, width: `${row.width}%` }}
							/>
						</div>
					</div>
				))}
			</div>
			<div className="hidden min-w-0 xl:col-start-3 xl:block">
				<RunCardSample />
			</div>
		</div>
	);
}

function RunCardSample() {
	return (
		<div className="flex flex-col overflow-hidden rounded-lg bg-card shadow-(--custom-shadow) corner-squircle squircle:rounded-3xl">
			<div className="flex h-[55px] shrink-0 items-center gap-2.5 border-b border-border/60 px-3">
				<Bone className="size-6 shrink-0 rounded-full" />
				<Bone className="h-4 w-16 rounded-sm" />
				<span className="flex-1" />
				<Bone className="h-3 w-20 rounded-sm" />
			</div>
			<div className="grid grid-cols-4 gap-4 border-b border-border/60 px-3 py-3">
				{CARD_FIGURES.map((key) => (
					<div key={key} className="flex flex-col gap-2">
						<Bone className="h-3 w-10 rounded-sm" />
						<Bone className="h-3.5 w-12 rounded-sm" />
						<Bone className="h-1 w-full rounded-full" />
					</div>
				))}
			</div>
			<div className="flex flex-col gap-1.5 px-3 py-3">
				{CARD_LANES.map((lane) => (
					<div key={lane.id} className="flex h-4 items-center gap-2">
						<Bone className="size-4 shrink-0 rounded-md" />
						<Bone className="h-3 w-3 shrink-0 rounded-sm" />
						<div className="relative h-4 min-w-0 flex-1 rounded-sm bg-muted/40">
							{lane.bars.map((left) => (
								<Bone
									key={left}
									className="absolute inset-y-0.5 w-[4%] rounded-sm"
									style={{ left: `${left}%` }}
								/>
							))}
						</div>
					</div>
				))}
				<div className="mt-1 h-12 rounded-sm bg-muted/40" />
			</div>
		</div>
	);
}

const RUNGS = [
	68, 78, 96, 106, 116, 128, 169, 178, 189, 197, 206, 218, 227, 304, 313, 326,
	347, 356, 389, 413, 426, 452, 464, 512, 521, 539,
].map((top) => ({ id: `rung-${top}`, top }));
const RAILS = [35, 69];

function MapSample() {
	return (
		<div className="-mx-6 -mt-2">
			<div className="flex h-[100cqh] flex-col pt-(--reader-pane-top,0.875rem)">
				<div className="relative min-h-0 flex-1">
					{RAILS.map((left) => (
						<Bone
							key={`rail-${left}`}
							className="absolute top-2 bottom-0 w-0.5 rounded-full"
							style={{ left: left - 1 }}
						/>
					))}
					<Bone className="absolute -top-px left-0 h-3.5 w-full rounded-full" />
					{RUNGS.map(({ id, top }) => (
						<Bone
							key={id}
							className="absolute h-px rounded-full"
							style={{ left: RAILS[0], top, width: RAILS[1] - RAILS[0] }}
						/>
					))}
					{RUNGS.flatMap(({ id, top }) =>
						RAILS.map((left) => (
							<Bone
								key={`${id}-${left}`}
								className="absolute size-[5px] rounded-full"
								style={{ left: left - 2.5, top: top - 2 }}
							/>
						)),
					)}
				</div>
			</div>
		</div>
	);
}

export function DetailColumnsSample() {
	return (
		<>
			<div className="flex min-w-0 items-start gap-8 pt-(--reader-top) xl:col-start-2 xl:row-start-1">
				<div className="flex min-w-0 flex-1 flex-col gap-8">
					<TurnSample trace />
					<TurnSample />
				</div>
			</div>
			<div className="grid w-14 xl:col-start-2 xl:row-start-1 xl:mr-[calc(var(--reader-card)+2rem)] xl:justify-self-end">
				<MapSample />
			</div>
		</>
	);
}

const RAIL_ROWS = [
	44, 40, 48, 44, 36, 44, 40, 48, 44, 40, 36, 44, 48, 40, 44, 36, 44, 40, 48,
	44, 40, 44,
].map((width, index) => ({ id: `row-${index}`, width }));
export function RailSample() {
	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-card shadow-(--custom-shadow) corner-squircle squircle:rounded-3xl">
			<div className="flex h-[45px] shrink-0 items-center justify-between gap-2 border-b border-border/60 pr-2 pl-4">
				<Bone className="h-3.5 w-20 rounded-sm" />
				<div className="flex shrink-0 items-center gap-1.5">
					<Bone className="h-7 w-[30px] rounded-full" />
					<Bone className="size-7 rounded-full" />
				</div>
			</div>
			<div className="flex min-h-0 flex-col gap-[3px] overflow-hidden px-1.5 pt-2">
				<div className="flex h-[34px] shrink-0 items-center justify-between rounded-md px-1.5">
					<Bone className="h-3 w-20 rounded-sm" />
					<Bone className="h-3 w-12 rounded-sm" />
				</div>
				{RAIL_ROWS.map(({ id, width }) => (
					<div
						key={id}
						className="flex h-[34px] shrink-0 items-center justify-between px-1.5"
					>
						<Bone className="h-3 rounded-sm" style={{ width }} />
						<Bone className="h-3 w-9 rounded-sm" />
					</div>
				))}
			</div>
		</div>
	);
}

export function DetailSample() {
	return (
		<div className="h-full min-h-0 overflow-hidden [--reader-pane-top:calc(var(--stage-top,0.5rem)+1rem)] [--reader-top:var(--tabs-band,var(--reader-inset))] [container-type:size]">
			<div className="grid grid-cols-[minmax(0,1fr)_3.5rem] gap-8 px-(--reader-gutter) pt-2 pb-(--reader-inset) xl:grid-cols-[var(--reader-rail)_minmax(0,1fr)] xl:gap-(--reader-columns-gap)">
				<div className="hidden xl:block">
					<div className="sticky top-2 flex h-[calc(100cqh-1rem)] min-h-0 flex-col">
						<RailSample />
					</div>
				</div>
				<DetailColumnsSample />
			</div>
		</div>
	);
}

const FIGURES = ["a", "b", "c", "d"];

export function PanesSample({ children }: { children?: ReactNode }) {
	return (
		<div className="h-full overflow-hidden px-8 pt-2 pb-2">
			<div className="flex h-full min-h-0 gap-6">
				<div className="flex min-h-0 w-(--reader-rail) shrink-0 flex-col">
					<RailSample />
				</div>
				{children}
			</div>
		</div>
	);
}

function SectionRows({ rows }: { rows: readonly number[] }) {
	return rows.map((width) => (
		<div key={width} className="flex h-6 items-center gap-2">
			<Bone className="size-4 shrink-0 rounded-sm" />
			<Bone className="h-3 rounded-sm" style={{ width: `${width}%` }} />
		</div>
	));
}

export function SummarySample() {
	return (
		<div className="h-full overflow-hidden px-8 pt-2 pb-2">
			<div className="flex h-full min-h-0 gap-6">
				<div className="hidden min-h-0 w-(--reader-rail) shrink-0 lg:flex lg:flex-col">
					<RailSample />
				</div>
				<div className="-mx-2 flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden px-2 pt-(--panes-top) *:shrink-0">
					<div className="flex min-w-0 flex-col gap-3 rounded-[10px] bg-card p-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_1px_-1px_rgba(0,0,0,0.1),0_1px_2px_0_rgba(0,0,0,0.05)] corner-squircle squircle:rounded-[20px] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.1)]">
						<div className="grid grid-cols-4 gap-4 px-1.5 pt-1.5 pb-0">
							{FIGURES.map((key) => (
								<Bone
									key={key}
									className="h-[49px] rounded-lg corner-squircle squircle:rounded-3xl"
								/>
							))}
						</div>
						<ContextMapSample />
					</div>
					<div className="grid gap-4 lg:grid-cols-2">
						<SummarySection title="Skills & Context files">
							<SectionRows rows={[64, 48, 56]} />
						</SummarySection>
						<SummarySection title="MCP & Tools">
							<SectionRows rows={[52, 60, 40]} />
						</SummarySection>
					</div>
					<div className="grid gap-4 lg:grid-cols-2">
						<SummarySection title="Files">
							<SectionRows rows={[72, 56, 64, 48, 60, 52]} />
						</SummarySection>
						<div className="grid min-w-0 grid-rows-2 gap-4">
							<SummarySection title="Pull requests">
								<SectionRows rows={[60]} />
							</SummarySection>
							<SummarySection title="CI">
								<SectionRows rows={[48]} />
							</SummarySection>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

const LIGHT_SAMPLES: Record<SessionReaderTab, () => ReactNode> = {
	ci: () => <PanesSample />,
	detail: () => <DetailSample />,
	files: () => <PanesSample />,
	setup: () => <PanesSample />,
	summary: () => <SummarySample />,
};

export function SessionReaderSkeleton({ tab }: { tab: SessionReaderTab }) {
	return (
		<Bones fill label="Loading session">
			{LIGHT_SAMPLES[tab]()}
		</Bones>
	);
}

const REPO_SESSION_PARAM = "session";

export function SessionReaderFallback() {
	const { sessionId } = useParams();
	const [searchParams] = useSearchParams();
	if (!sessionId && !searchParams.has(REPO_SESSION_PARAM))
		return <ProductLoadingIndicator />;
	return (
		<div className="dashboardy-page relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--dashboard-01-content-background,#fcfcfc)] [--panes-top:calc(var(--stage-top)-0.125rem)] [--stage-top:--spacing(13)] [--tabs-band:--spacing(19)]">
			<SessionReaderSkeleton
				tab={readSessionReaderTab(searchParams.get(SESSION_TAB_PARAM))}
			/>
		</div>
	);
}
