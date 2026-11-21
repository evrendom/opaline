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
		<div className="flex gap-l">
			<Bone className="mt-s size-6 shrink-0 corner-full" />
			<div className="flex min-w-0 flex-1 flex-col gap-xxl corner-m bg-card px-l py-l text-body-xl shadow-card corner-squircle squircle:corner-xl">
				{MEMBER_PARAGRAPHS.map((paragraph) => (
					<p key={paragraph}>{paragraph}</p>
				))}
			</div>
		</div>
	);
}

function TurnSample({ trace = false }: { trace?: boolean }) {
	return (
		<div className="flex w-full flex-col gap-[calc(var(--space-xxl)*4/3)] text-body-xl">
			<div className={cn("flex flex-col gap-m", READING_MEASURE)}>
				<div className="flex flex-wrap items-center gap-m pl-[calc(var(--space-xxl)*1.5)] text-body-m">
					<span className="font-medium">you</span>
					<span className="tabular-nums">Oct 22, 08:48</span>
					<span className="tabular-nums">~8K tokens · 0.8%</span>
				</div>
				<MemberSample />
			</div>
			<div className="relative flex flex-col gap-xl">
				<div className={cn("flex gap-l", READING_MEASURE)}>
					<Bone className="size-6 shrink-0 corner-full" />
					<div className="min-w-0 flex-1">
						<div className="flex flex-col gap-m px-xs pt-xs">
							<Bone className="h-3.5 w-full corner-xs" />
							<Bone className="h-3.5 w-11/12 corner-xs" />
							<Bone className="h-3.5 w-2/3 corner-xs" />
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
		<div className="grid gap-[calc(var(--space-xxl)*4/3)] xl:grid-cols-[minmax(0,1fr)_3.5rem_var(--reader-card)]">
			<div className="flex min-w-0 flex-col gap-xxl pl-[calc(var(--space-xxl)*1.5)] pt-m">
				{TRACE_ROWS.map((row) => (
					<div key={row.id} className="flex h-6 items-center gap-m">
						<Bone className="size-5 shrink-0 corner-s" />
						<Bone
							className="h-3 shrink-0 corner-xs"
							style={{ width: row.label }}
						/>
						<div className="relative h-3 min-w-0 flex-1">
							<Bone
								className="absolute inset-y-0 corner-xs"
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
		<div className="flex flex-col overflow-hidden corner-m bg-card shadow-card corner-squircle squircle:corner-xl">
			<div
				className={cn(
					"flex h-[55px] shrink-0 items-center gap-l",
					"edge-b-m px-l",
					// design-escape-ok(opacity): shipped value; border/60
					"border-line-strong/60",
				)}
			>
				<Bone className="size-6 shrink-0 corner-full" />
				<Bone className="h-4 w-16 corner-xs" />
				<span className="flex-1" />
				<Bone className="h-3 w-20 corner-xs" />
			</div>
			{/* design-escape-ok(opacity): shipped value; border/60 */}
			<div className="grid grid-cols-4 gap-xl edge-b-m border-line-strong/60 px-l py-l">
				{CARD_FIGURES.map((key) => (
					<div key={key} className="flex flex-col gap-m">
						<Bone className="h-3 w-10 corner-xs" />
						<Bone className="h-3.5 w-12 corner-xs" />
						<Bone className="h-1 w-full corner-full" />
					</div>
				))}
			</div>
			<div className="flex flex-col gap-s px-l py-l">
				{CARD_LANES.map((lane) => (
					<div key={lane.id} className="flex h-4 items-center gap-m">
						<Bone className="size-4 shrink-0 corner-s" />
						<Bone className="h-3 w-3 shrink-0 corner-xs" />
						{/* design-escape-ok(opacity): no role renders this; bg-field/40 */}
						<div className="relative h-4 min-w-0 flex-1 corner-xs bg-field/40">
							{lane.bars.map((left) => (
								<Bone
									key={left}
									className="absolute inset-y-0.5 w-[4%] corner-xs"
									style={{ left: `${left}%` }}
								/>
							))}
						</div>
					</div>
				))}
				{/* design-escape-ok(opacity): no role renders this; bg-field/40 */}
				<div className="mt-xs h-12 corner-xs bg-field/40" />
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
		<div className="-mx-xxl -mt-m">
			<div className="flex h-[100cqh] flex-col pt-(--reader-pane-top,0.875rem)">
				<div className="relative min-h-0 flex-1">
					{RAILS.map((left) => (
						<Bone
							key={`rail-${left}`}
							className="absolute top-2 bottom-0 w-0.5 corner-full"
							style={{ left: left - 1 }}
						/>
					))}
					<Bone className="absolute -top-px left-0 h-3.5 w-full corner-full" />
					{RUNGS.map(({ id, top }) => (
						<Bone
							key={id}
							className="absolute h-px corner-full"
							style={{ left: RAILS[0], top, width: RAILS[1] - RAILS[0] }}
						/>
					))}
					{RUNGS.flatMap(({ id, top }) =>
						RAILS.map((left) => (
							<Bone
								key={`${id}-${left}`}
								className="absolute size-[5px] corner-full"
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
			<div className="flex min-w-0 items-start gap-[calc(var(--space-xxl)*4/3)] pt-(--reader-top) xl:col-start-2 xl:row-start-1">
				<div className="flex min-w-0 flex-1 flex-col gap-[calc(var(--space-xxl)*4/3)]">
					<TurnSample trace />
					<TurnSample />
				</div>
			</div>
			<div className="grid w-14 xl:col-start-2 xl:row-start-1 xl:mr-[calc(var(--reader-card)+var(--space-xxl)*4/3)] xl:justify-self-end">
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
		<div className="flex h-full min-h-0 flex-col overflow-hidden corner-m bg-card shadow-card corner-squircle squircle:corner-xl">
			<div
				className={cn(
					"flex h-[45px] shrink-0 items-center justify-between gap-m",
					"edge-b-m pr-m pl-xl",
					// design-escape-ok(opacity): shipped value; border/60
					"border-line-strong/60",
				)}
			>
				<Bone className="h-3.5 w-20 corner-xs" />
				<div className="flex shrink-0 items-center gap-s">
					<Bone className="h-7 w-[30px] corner-full" />
					<Bone className="size-7 corner-full" />
				</div>
			</div>
			<div className="flex min-h-0 flex-col gap-xs overflow-hidden px-s pt-m">
				<div className="flex h-[34px] shrink-0 items-center justify-between corner-s px-s">
					<Bone className="h-3 w-20 corner-xs" />
					<Bone className="h-3 w-12 corner-xs" />
				</div>
				{RAIL_ROWS.map(({ id, width }) => (
					<div
						key={id}
						className="flex h-[34px] shrink-0 items-center justify-between px-s"
					>
						<Bone className="h-3 corner-xs" style={{ width }} />
						<Bone className="h-3 w-9 corner-xs" />
					</div>
				))}
			</div>
		</div>
	);
}

export function DetailSample() {
	return (
		<div className="h-full min-h-0 overflow-hidden [--reader-pane-top:calc(var(--stage-top,0.5rem)+1rem)] [--reader-top:var(--tabs-band,var(--reader-inset))] [container-type:size]">
			<div
				className={cn(
					"grid grid-cols-[minmax(0,1fr)_3.5rem] gap-[calc(var(--space-xxl)*4/3)]",
					"px-(--reader-gutter) pt-m pb-(--reader-inset)",
					"xl:grid-cols-[var(--reader-rail)_minmax(0,1fr)] xl:gap-(--reader-columns-gap)",
				)}
			>
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
		<div className="h-full overflow-hidden px-[calc(var(--space-xxl)*4/3)] pt-m pb-m">
			<div className="flex h-full min-h-0 gap-xxl">
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
		<div key={width} className="flex h-6 items-center gap-m">
			<Bone className="size-4 shrink-0 corner-xs" />
			<Bone className="h-3 corner-xs" style={{ width: `${width}%` }} />
		</div>
	));
}

export function SummarySample() {
	return (
		<div className="h-full overflow-hidden px-[calc(var(--space-xxl)*4/3)] pt-m pb-m">
			<div className="flex h-full min-h-0 gap-xxl">
				<div className="hidden min-h-0 w-(--reader-rail) shrink-0 lg:flex lg:flex-col">
					<RailSample />
				</div>
				<div
					className={cn(
						"flex min-h-0 min-w-0 flex-1 flex-col gap-xl overflow-hidden",
						"-mx-m px-m pt-(--panes-top)",
						"*:shrink-0",
					)}
				>
					<div className="flex min-w-0 flex-col gap-l corner-m bg-card p-m shadow-chip corner-squircle squircle:corner-xl">
						<div className="grid grid-cols-4 gap-xl px-s pt-s pb-zero">
							{FIGURES.map((key) => (
								<Bone
									key={key}
									className="h-[49px] corner-m corner-squircle squircle:corner-xl"
								/>
							))}
						</div>
						<ContextMapSample />
					</div>
					<div className="grid gap-xl lg:grid-cols-2">
						<SummarySection title="Skills & Context files">
							<SectionRows rows={[64, 48, 56]} />
						</SummarySection>
						<SummarySection title="MCP & Tools">
							<SectionRows rows={[52, 60, 40]} />
						</SummarySection>
					</div>
					<div className="grid gap-xl lg:grid-cols-2">
						<SummarySection title="Files">
							<SectionRows rows={[72, 56, 64, 48, 60, 52]} />
						</SummarySection>
						<div className="grid min-w-0 grid-rows-2 gap-xl">
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
		<div className="dashboardy-page relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-inset [--panes-top:calc(var(--stage-top)-0.125rem)] [--stage-top:--spacing(13)] [--tabs-band:--spacing(19)]">
			<SessionReaderSkeleton
				tab={readSessionReaderTab(searchParams.get(SESSION_TAB_PARAM))}
			/>
		</div>
	);
}
