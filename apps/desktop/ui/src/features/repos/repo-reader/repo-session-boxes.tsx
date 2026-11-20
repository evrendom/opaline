import type { DashboardMetric, RepositorySessionBox } from "@rudel/api-routes";
import { IconClick } from "@tabler/icons-react";
import {
	type CSSProperties,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { Reveal } from "@/app/ui/bones";
import { useElementWidth } from "@/app/ui/horizontal-resize-handle";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import { EmptyState } from "@/components/dashboard/page-parts";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import {
	METRIC_APPEARANCE,
	USAGE_APPEARANCE,
} from "@/features/costs/cost-chart";
import { formatMetric, METRIC_LABELS } from "@/features/costs/cost-format";
import { useDotPick } from "@/features/costs/cost-hover-date";
import { formatPoints } from "@/features/costs/plan-usage/plan-usage-chart";
import { useSharedUsageSelected } from "@/features/costs/plan-usage/usage-selection";
import {
	sessionUsageShares,
	usePlanUsage,
} from "@/features/costs/plan-usage/use-plan-usage";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { tileLook } from "@/features/sessions/reader/context/session-reader-context-bar";
import { ContextMapFrame } from "@/features/sessions/reader/context/session-reader-context-frame";
import { ContextMapSample } from "@/features/sessions/reader/context/session-reader-context-map-sample";
import {
	GhostTiles,
	useTileMorph,
} from "@/features/sessions/reader/context/session-reader-context-morph";
import {
	GAP,
	type Placed,
} from "@/features/sessions/reader/context/session-reader-context-place";
import { squarify } from "@/features/sessions/reader/summary/session-reader-breakdown";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { useRepoData, useRepoRangeInput } from "./repo-page-data";
import { type RailFilter, useRailFilter } from "./repo-rail-highlight";
import { ContextPartTiles } from "./repo-session-parts";
import {
	SessionPreview,
	usePrefetchSessionPreview,
} from "./repo-session-preview";

const AREA_HEIGHT = 420;
const LEAST_FILL_HEIGHT = 160;
const MIN_TILE = 8;

type BoxMetric = Extract<
	DashboardMetric,
	| "cost"
	| "sessions"
	| "agentRuns"
	| "signals"
	| "mergedPullRequests"
	| "ciRuns"
>;

const BOX_METRICS: readonly BoxMetric[] = [
	"cost",
	"sessions",
	"agentRuns",
	"signals",
	"mergedPullRequests",
	"ciRuns",
];

const dayWord = (date: string) =>
	new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	});

const dayWords = (start: string, end: string) =>
	start === end ? dayWord(start) : `${dayWord(start)} – ${dayWord(end)}`;

const shortId = (sessionId: string) => sessionId.split("-")[0] ?? sessionId;

type BoxView = BoxMetric | "usage";

function sizeOf(
	session: RepositorySessionBox,
	view: BoxView,
	usage: ReadonlyMap<string, number> | null,
): number {
	if (view === "usage") return usage?.get(session.sessionId) ?? 0;
	if (view === "cost") return session.cost;
	if (view === "sessions") return 1;
	if (view === "agentRuns") return session.agentRuns;
	if (view === "signals") return session.signals;
	if (view === "mergedPullRequests") return session.mergedPullRequests;
	return session.ciRuns;
}

function lookOf(view: BoxView) {
	return view === "usage"
		? { ...USAGE_APPEARANCE, label: "Usage" }
		: { ...METRIC_APPEARANCE[view], label: METRIC_LABELS[view] };
}

function readMetric(value: string | null): BoxMetric {
	return BOX_METRICS.find((each) => each === value) ?? "cost";
}

type Tile = {
	key: string;
	session: RepositorySessionBox;
	value: number;
	size: number;
	x: number;
	y: number;
	w: number;
	h: number;
};

function useElementHeight<T extends HTMLElement>(ref: RefObject<T | null>) {
	const [height, setHeight] = useState(0);
	useLayoutEffect(() => {
		const element = ref.current;
		if (element) setHeight(element.clientHeight);
	});
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setHeight(element.clientHeight));
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return height;
}

export function RepoSessionBoxes({ fill = false }: { fill?: boolean }) {
	const { repoKey } = useRepoData();
	const range = useRepoRangeInput();
	const [params] = useSearchParams();
	const metric = readMetric(params.get("metric"));
	const desktop = useLocalDesktopApp();
	const usagePicked = useSharedUsageSelected() && desktop;
	const plan = usePlanUsage(usagePicked, range);
	const view: BoxView = usagePicked && plan.data !== null ? "usage" : metric;
	const usage = useMemo(
		() => (view === "usage" ? sessionUsageShares(plan.data) : null),
		[view, plan.data],
	);
	const boxes = useAnalyticsQuery({
		...orpc.analytics.repositories.sessionBoxes.queryOptions({
			input: { repoKey, range },
		}),
		placeholderData: (previous, query) =>
			query?.queryKey.some(
				(part) =>
					typeof part === "object" &&
					part !== null &&
					"input" in part &&
					(part.input as { repoKey?: string }).repoKey === repoKey,
			)
				? previous
				: undefined,
		staleTime: 5 * 60_000,
	});
	const loaded =
		boxes.data !== undefined && (view !== "usage" || plan.data !== undefined);
	const picked = useDotPick()?.picked ?? null;
	const clamped = picked
		? {
				start: picked.date > range.startDate ? picked.date : range.startDate,
				end: picked.end < range.endDate ? picked.end : range.endDate,
			}
		: null;
	const day = clamped && clamped.start <= clamped.end ? clamped : null;
	const dayStart = day?.start ?? null;
	const dayEnd = day?.end ?? null;
	const sessions = useMemo(() => {
		const all = boxes.data?.sessions ?? [];
		if (dayStart === null || dayEnd === null) return all;
		return all.filter((session) => {
			const started = session.startedAt.slice(0, 10);
			return started >= dayStart && started <= dayEnd;
		});
	}, [boxes.data, dayStart, dayEnd]);
	const area = useRef<HTMLDivElement>(null);
	const width = useElementWidth(area);
	const filled = useElementHeight(area);
	const height = fill ? Math.max(LEAST_FILL_HEIGHT, filled) : AREA_HEIGHT;
	const tiles = useMemo(
		() => placeSessions(sessions, view, usage, width, height),
		[sessions, view, usage, width, height],
	);
	const drawn = useMemo(() => tiles.map(placedOf), [tiles]);
	const list = useRef<HTMLUListElement>(null);
	const rangeKey = `${range.startDate} ${range.endDate}`;
	const [shownRange, setShownRange] = useState(rangeKey);
	if (boxes.data && !boxes.isPlaceholderData && shownRange !== rangeKey)
		setShownRange(rangeKey);
	const morphSource = `${view} ${dayStart ?? ""} ${dayEnd ?? ""} ${shownRange}`;
	const ghosts = useTileMorph({
		compactedRuns: undefined,
		drawn,
		list,
		source: morphSource,
		width,
	});
	const [pickedKey, setPickedKey] = useState<string | null>(null);
	const pickedSession =
		sessions.find((session) => session.sessionId === pickedKey) ?? null;
	const pickedTile = tiles.find((tile) => tile.key === pickedKey) ?? null;
	usePickedMove(list, pickedTile, morphSource);
	useEffect(() => {
		if (!pickedSession) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setPickedKey(null);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [pickedSession]);
	const railFilter = useMemo<RailFilter | null>(
		() =>
			pickedSession
				? {
						days: null,
						figures: {
							sessions: 1,
							agentRuns: pickedSession.agentRuns,
							cost: pickedSession.cost,
							unpricedRuns: pickedSession.unpricedRuns,
							signals: pickedSession.signals,
							mergedPullRequests: pickedSession.mergedPullRequests,
							ciRuns: pickedSession.ciRuns,
						},
						name: shortId(pickedSession.sessionId),
						focus: pickedSession.startedAt.slice(0, 10),
						onClear: () => setPickedKey(null),
					}
				: null,
		[pickedSession],
	);
	useRailFilter(railFilter);
	const look = lookOf(view);
	const Icon = look.icon;

	return (
		<section
			aria-label="Sessions"
			className={cn("flex flex-col gap-m", fill && "min-h-0 flex-1")}
		>
			<div className="flex items-baseline justify-between gap-l px-xs">
				<h2 className="flex items-center gap-s text-body-xl font-medium text-ink">
					<Icon
						aria-hidden="true"
						className="size-3.5"
						style={{ color: look.color }}
					/>
					Sessions by {look.label.toLowerCase()}
					{day ? (
						<span className="font-regular text-ink-3">
							{" "}
							· {dayWords(day.start, day.end)}
						</span>
					) : null}
				</h2>
			</div>
			<ContextMapFrame className={fill ? "min-h-0 flex-1" : undefined}>
				<div
					ref={area}
					className={cn("min-w-0", fill && "relative min-h-0 flex-1")}
				>
					{loaded && tiles.length === 0 && ghosts.length === 0 ? (
						<div
							className={fill ? "absolute inset-0" : undefined}
							style={fill ? undefined : { height }}
						>
							<EmptyState
								icon={look.outline}
								title={`No ${look.label.toLowerCase()} ${day ? "on this day" : "in this period"}`}
								description="No session of this repo has any. Pick another range or metric in the rail."
								className="h-full corner-s corner-squircle squircle:corner-l"
							/>
						</div>
					) : (
						<Reveal
							label="Loading sessions"
							loading={!loaded}
							sample={
								<div style={{ height: height - 2 * GAP }}>
									<ContextMapSample fill />
								</div>
							}
							sampleId="repo-session-boxes"
						>
							{() => (
								<ul
									ref={list}
									className="relative"
									style={
										{
											height,
											"--tint": look.color,
										} as CSSProperties
									}
								>
									{tiles.map((tile) => (
										<SessionTile
											key={tile.key}
											figure={
												view === "usage"
													? formatPoints(tile.value)
													: view === "sessions"
														? `${tile.session.agentRuns} run${tile.session.agentRuns === 1 ? "" : "s"}`
														: formatMetric(tile.value, view)
											}
											tile={tile}
											picked={tile.key === pickedKey}
											dimmed={pickedSession !== null && tile.key !== pickedKey}
											onPick={() =>
												setPickedKey((current) =>
													current === tile.key ? null : tile.key,
												)
											}
										/>
									))}
									<GhostTiles ghosts={ghosts} look={GHOST_LOOK} />
								</ul>
							)}
						</Reveal>
					)}
				</div>
				{!loaded || tiles.length > 0 || ghosts.length > 0 ? (
					<div
						data-session-pick=""
						className={cn(
							"relative mt-s flex flex-col",
							fill ? "min-h-0 flex-1" : "h-[420px]",
						)}
						style={{ "--tint": look.color } as CSSProperties}
					>
						{pickedSession ? (
							<SessionPreview sessionId={pickedSession.sessionId} />
						) : (
							<EmptyState
								icon={IconClick}
								title="Pick a session"
								description="Click a box above to see what happened in that session, with its figures in the rail."
								className="h-full corner-s corner-squircle squircle:corner-l"
							/>
						)}
					</div>
				) : null}
			</ContextMapFrame>
		</section>
	);
}

function placedOf(tile: Tile): Placed {
	return {
		h: tile.h,
		key: tile.key,
		part: {
			count: 1,
			key: tile.key,
			kind: "model",
			label: tile.session.sessionId.split("-")[0] ?? tile.session.sessionId,
			tokens: tile.value,
		},
		tokens: tile.value,
		w: tile.w,
		x: tile.x,
		y: tile.y,
	};
}

const MOVE_DURATION = 480;
const MOVE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

function usePickedMove(
	list: RefObject<HTMLUListElement | null>,
	tile: Tile | null,
	source: string,
) {
	const last = useRef<{
		key: string;
		rect: { h: number; w: number; x: number; y: number };
		source: string;
	} | null>(null);
	useLayoutEffect(() => {
		const was = last.current;
		last.current = tile
			? {
					key: tile.key,
					rect: { h: tile.h, w: tile.w, x: tile.x, y: tile.y },
					source,
				}
			: null;
		if (!tile || !was || was.key !== tile.key || was.source === source) return;
		if (
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		const element = list.current?.querySelector<HTMLElement>(
			`[data-tile-key="${CSS.escape(tile.key)}"]`,
		);
		if (!element) return;
		for (const running of element.getAnimations()) running.cancel();
		const box = (rect: { h: number; w: number; x: number; y: number }) => ({
			height: `${Math.max(0, rect.h - GAP)}px`,
			left: `${rect.x}px`,
			top: `${rect.y}px`,
			width: `${Math.max(0, rect.w - GAP)}px`,
		});
		const move = element.animate([box(was.rect), box(tile)], {
			duration: MOVE_DURATION,
			easing: MOVE_EASING,
			fill: "backwards",
		});
		move.pause();
		const frame = requestAnimationFrame(() => move.play());
		return () => cancelAnimationFrame(frame);
	}, [list, tile, source]);
}

function placeSessions(
	sessions: readonly RepositorySessionBox[],
	view: BoxView,
	usage: ReadonlyMap<string, number> | null,
	width: number,
	height: number,
): Tile[] {
	if (width <= 0) return [];
	const ranked = sessions
		.map((session) => ({ session, value: sizeOf(session, view, usage) }))
		.filter((each) => each.value > 0);
	const total = ranked.reduce((sum, each) => sum + each.value, 0);
	if (total <= 0) return [];
	const side = MIN_TILE + GAP;
	const floor = (total * side * side) / (width * height);
	const byKey = new Map(ranked.map((each) => [each.session.sessionId, each]));
	return squarify(
		ranked.map((each) => ({
			color: "",
			label: each.session.sessionId,
			value: Math.max(each.value, floor),
		})),
		width,
		height,
	).flatMap((cell): Tile[] => {
		const own = byKey.get(cell.part.label);
		return own
			? [
					{
						key: own.session.sessionId,
						session: own.session,
						value: own.value,
						size: cell.part.value,
						x: cell.left,
						y: cell.top,
						w: cell.width,
						h: cell.height,
					},
				]
			: [];
	});
}

const NAMED_SIDE = { h: 28, w: 56 } as const;

const GHOST_LOOK = { className: tileLook("model").className };

function SessionTile({
	figure,
	tile,
	picked,
	dimmed,
	onPick,
}: {
	figure: string;
	tile: Tile;
	picked: boolean;
	dimmed: boolean;
	onPick: () => void;
}) {
	const prefetch = usePrefetchSessionPreview();
	const onIntent = () => prefetch(tile.session.sessionId);
	const w = Math.max(0, tile.w - GAP);
	const h = Math.max(0, tile.h - GAP);
	const look = tileLook("model");
	const showName = h >= NAMED_SIDE.h && w >= NAMED_SIDE.w;
	const showGlyph = w >= TILE_ICON_ROOM && h >= TILE_ICON_ROOM;
	const session = tile.session;
	const label = shortId(session.sessionId);
	const Glyph = getModelIconComponent(session.model ?? undefined);
	return (
		<li
			data-tile-key={tile.key}
			aria-label={`Session ${label} – ${figure}`}
			className={cn(
				"group/tile absolute overflow-hidden corner-s edge-m corner-squircle squircle:corner-l",
				look.className,
				"transition-opacity duration-200",
				"transition-[filter] duration-200",
				dimmed && "[filter:opacity(0.4)]",
				picked &&
					"z-40 bg-[color-mix(in_oklab,var(--tint)_34%,transparent)] shadow-[0_2px_10px_-2px_color-mix(in_oklab,var(--tint)_45%,transparent)] dark:bg-[color-mix(in_oklab,var(--tint)_40%,transparent)] dark:shadow-[0_2px_12px_-2px_color-mix(in_oklab,var(--tint)_55%,transparent)]",
			)}
			style={{ height: h, left: tile.x, top: tile.y, width: w }}
		>
			<button
				type="button"
				aria-pressed={picked}
				aria-label={`Show what's in session ${label}`}
				onClick={onPick}
				onPointerEnter={onIntent}
				onFocus={onIntent}
				title={`${session.sessionId}\n${figure}`}
				className="absolute inset-0 rounded-[calc(var(--radius-s)-1px)] corner-squircle outline-none transition-colors hover:bg-hover squircle:rounded-[calc(var(--radius-xl)-1px)]"
			/>
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none relative flex min-w-0 flex-col text-body-l",
					showName ? "px-l py-xs" : "h-full items-center justify-center",
				)}
			>
				<span className="flex min-w-0 items-center gap-s">
					{Glyph && showGlyph ? (
						<Glyph aria-hidden="true" className="size-3.5 shrink-0" />
					) : null}
					{showName ? (
						<span className="truncate font-medium">{label}</span>
					) : null}
				</span>
			</span>
			{showName && session.context ? (
				<ContextPartTiles
					context={session.context}
					h={h}
					top={NAMED_SIDE.h}
					w={w}
				/>
			) : null}
		</li>
	);
}

const TILE_ICON_ROOM = 22;
