import {
	useContext,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import {
	ReaderLayoutContext,
	useReaderLayoutSettled,
} from "../detail/reader-layout";
import { railTagTint } from "../rail/session-reader-rail-tags";
import { readerContentOf, readerScrollerOf } from "../reader-dom";
import { markSubagentProgress } from "../subagents/session-reader-subagent-chip";
import { useSubagentTintById } from "../subagents/session-reader-subagent-tints";
import { useSubagentsCounted } from "../subagents/session-reader-subagents-counted";
import {
	type Drawn,
	keyed,
	markReading,
	minimapBox,
} from "./session-reader-minimap-drawn";
import { focusMapping } from "./session-reader-minimap-focus";
import { MinimapHeads } from "./session-reader-minimap-heads";
import {
	focusedOn,
	laneCount,
	mainLaneX,
	minimapLine,
	subagentX,
} from "./session-reader-minimap-line";
import {
	attachSessionMap,
	MAX_SCALE,
	useLaidOutShapes,
} from "./session-reader-minimap-session";
import {
	loadSessionMap,
	type SessionMapKey,
} from "./session-reader-minimap-store";

const HIT =
	"cursor-pointer fill-none stroke-[6px] opacity-0 transition-opacity [stroke-linecap:round] [stroke-linejoin:round] hover:opacity-25";

const NO_TAGS: readonly string[] = [];

export function ReaderMinimap({
	focus = null,
	mapKey = null,
	member = { imageUrl: undefined, label: "" },
	model = null,
	onFocus,
	tags = NO_TAGS,
}: {
	tags?: readonly string[];
	mapKey?: SessionMapKey | null;
	member?: { imageUrl: string | undefined; label: string };
	model?: string | null;
	focus?: string | null;
	onFocus?: (subagentId: string | null) => void;
} = {}) {
	const settled = useReaderLayoutSettled();
	const settledRef = useRef(settled);
	settledRef.current = settled;
	const layout = useContext(ReaderLayoutContext);
	const mapKeyRef = useRef(mapKey);
	mapKeyRef.current = mapKey;
	const redrawRef = useRef<(() => void) | null>(null);
	const mapRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<HTMLDivElement>(null);
	const litRef = useRef<SVGRectElement>(null);
	const drawnOnceRef = useRef(false);
	const [drawn, setDrawn] = useState<Drawn>({
		height: 0,
		parts: [],
		scale: 0,
		width: 0,
	});
	const litId = useId();
	const tintOf = useSubagentTintById();
	const tint = (id: string | undefined) =>
		tintOf(id) ?? "var(--color-pink-500)";
	const withSubagents = useSubagentsCounted();
	const parts = useMemo(
		() =>
			withSubagents
				? drawn.parts
				: drawn.parts.filter(
						(part) => part.kind !== "subagent" && part.kind !== "talk",
					),
		[drawn.parts, withSubagents],
	);
	const line = useMemo(
		() => minimapLine(parts, drawn.scale, drawn.width),
		[parts, drawn.scale, drawn.width],
	);
	const talks = useMemo(() => keyed(line.talks, (talk) => talk.id), [line]);
	const nodes = useMemo(
		() => keyed(line.nodes, (node) => `${node.kind}:${node.id ?? ""}`),
		[line],
	);
	const lanes = laneCount(parts);
	const scaleRef = useRef(0);
	const toPageRef = useRef<((y: number) => number) | null>(null);
	const readingRef = useRef(0);
	const subagentsRef = useRef(line.subagents);
	subagentsRef.current = line.subagents;
	useLayoutEffect(() => {
		const scroller = readerScrollerOf(mapRef.current);
		if (scroller)
			markSubagentProgress(scroller, readingRef.current, line.subagents);
	}, [line]);
	const focusSpanRef = useRef<{ bottom: number; top: number } | null>(null);
	focusSpanRef.current = focus
		? (line.subagents.find((each) => each.id === focus) ?? null)
		: null;
	const focusTalksRef = useRef<number[]>([]);
	focusTalksRef.current = line.talks.flatMap((talk) =>
		talk.id === focus ? [talk.y] : [],
	);
	const laidOutRef = useLaidOutShapes(layout);
	const sessionRef = useRef<Drawn | null>(null);
	useLayoutEffect(() => {
		const map = mapRef.current;
		const view = viewRef.current;
		const scroller = readerScrollerOf(map);
		const content = scroller ? readerContentOf(scroller) : null;
		if (!map || !view || !scroller || !content) return;
		const box = minimapBox(
			view,
			() => litRef.current,
			() => drawnOnceRef.current,
		);
		const key = mapKeyRef.current;
		const stored = key ? loadSessionMap(key) : null;
		const kept = focus && !sessionRef.current ? stored : null;
		if (kept)
			sessionRef.current = {
				height: map.clientHeight,
				parts: kept.parts,
				scale: Math.min(
					map.clientHeight / Math.max(kept.pageHeight, 1),
					MAX_SCALE,
				),
				width: map.clientWidth,
			};
		const whole = sessionRef.current;
		if (focus && whole) {
			const zoom = focusedOn(whole.parts, focus, whole.height);
			const shown = zoom ? { ...whole, ...zoom } : whole;
			setDrawn({ ...shown, easing: drawnOnceRef.current });
			box.ease();
			drawnOnceRef.current = true;
			scaleRef.current = shown.scale;
			const placeFocused = () => {
				const span = focusSpanRef.current;
				if (!span) return;
				const { toMap } = focusMapping(scroller, span, focusTalksRef.current);
				const top = toMap(scroller.scrollTop);
				const height = Math.max(
					toMap(scroller.scrollTop + scroller.clientHeight) - top,
					2,
				);
				box.place(top, height);
				readingRef.current = markReading(
					scroller,
					top,
					height,
					subagentsRef.current,
				);
			};
			const onFocusedScroll = () => {
				box.hold();
				placeFocused();
			};
			placeFocused();
			const frame = requestAnimationFrame(placeFocused);
			scroller.addEventListener("scroll", onFocusedScroll, { passive: true });
			const resize = new ResizeObserver(placeFocused);
			resize.observe(content);
			return () => {
				cancelAnimationFrame(frame);
				resize.disconnect();
				scroller.removeEventListener("scroll", onFocusedScroll);
				box.hold();
			};
		}
		const session = attachSessionMap({
			box,
			content,
			key,
			layout,
			map,
			refs: {
				drawnOnce: drawnOnceRef,
				laidOut: laidOutRef,
				reading: readingRef,
				scale: scaleRef,
				session: sessionRef,
				settled: settledRef,
				subagents: subagentsRef,
				toPage: toPageRef,
			},
			scroller,
			setDrawn,
			stored,
			tags,
		});
		redrawRef.current = session.redraw;
		return () => {
			redrawRef.current = null;
			session.stop();
		};
	}, [focus, tags, layout, laidOutRef]);
	useLayoutEffect(() => {
		if (settled) redrawRef.current?.();
	}, [settled]);

	const grabRef = useRef<number | null>(null);
	const scrollTo = (clientY: number) => {
		const map = mapRef.current;
		const scroller = readerScrollerOf(map);
		const scale = scaleRef.current;
		if (!map || !scroller || !scale || grabRef.current === null) return;
		const y = clientY - map.getBoundingClientRect().top;
		const span = focus && sessionRef.current ? focusSpanRef.current : null;
		if (span) {
			scroller.scrollTop = focusMapping(
				scroller,
				span,
				focusTalksRef.current,
			).toPage(y - grabRef.current);
			return;
		}
		const at = (y - grabRef.current) / scale;
		scroller.scrollTop = toPageRef.current ? toPageRef.current(at) : at;
	};

	return (
		<div
			ref={mapRef}
			aria-hidden="true"
			className={cn(
				"relative isolate min-h-0 flex-1 cursor-pointer touch-none select-none transition-opacity duration-300",
				focus && "overflow-y-clip",
				drawn.parts.length === 0 && "opacity-0",
			)}
			onPointerDown={(event) => {
				const view = viewRef.current;
				const map = mapRef.current;
				if (!view || !map) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				const y = event.clientY - map.getBoundingClientRect().top;
				const viewTop =
					view.getBoundingClientRect().top - map.getBoundingClientRect().top;
				const viewHeight = view.offsetHeight;
				grabRef.current =
					y >= viewTop && y <= viewTop + viewHeight
						? y - viewTop
						: viewHeight / 2;
				scrollTo(event.clientY);
			}}
			onPointerMove={(event) => scrollTo(event.clientY)}
			onPointerUp={() => {
				grabRef.current = null;
			}}
			onPointerCancel={() => {
				grabRef.current = null;
			}}
		>
			<svg
				aria-hidden="true"
				data-easing={drawn.easing ? "" : undefined}
				className="pointer-events-none absolute inset-0 z-10 overflow-visible motion-safe:data-easing:[&_circle]:[transition:cx_300ms_ease-out,cy_300ms_ease-out,opacity_150ms_ease-out] motion-safe:data-easing:[&_path]:[transition:d_300ms_ease-out,opacity_150ms_ease-out] motion-safe:data-easing:[&_circle]:starting:opacity-0 motion-safe:data-easing:[&_path]:starting:opacity-0"
				height={drawn.height}
				width={drawn.width}
			>
				<defs>
					<clipPath id={litId}>
						<rect ref={litRef} height={0} width={drawn.width} x={0} y={0} />
					</clipPath>
				</defs>
				{[
					mainLaneX(lanes).member,
					mainLaneX(lanes).agent,
					...Array.from({ length: lanes }, (_, lane) => subagentX(lane, lanes)),
				].map((share, index) => (
					<path
						// biome-ignore lint/suspicious/noArrayIndexKey: lanes are their order
						key={index}
						className="stroke-zinc-950/6 dark:stroke-white/6"
						d={`M${share * drawn.width} 0V${drawn.height}`}
						strokeWidth={1}
					/>
				))}
				<path
					className="fill-none stroke-violet-500/30 dark:stroke-violet-400/30"
					d={`${line.rail} ${line.branches}`}
					strokeLinecap="round"
					strokeWidth={1.5}
				/>
				{line.subagents.map((each, index) => (
					<path
						key={`${each.id ?? index}`}
						className="fill-none"
						d={each.d}
						strokeLinecap="round"
						strokeWidth={1.5}
						style={{
							stroke: `color-mix(in oklab, ${tint(each.id)} 30%, transparent)`,
						}}
					/>
				))}
				{focus && sessionRef.current ? null : (
					<g
						className="[filter:drop-shadow(0_0_3px_var(--color-violet-500))] dark:[filter:drop-shadow(0_0_4px_var(--color-violet-400))]"
						clipPath={`url(#${litId})`}
					>
						<path
							className="fill-none stroke-violet-500 dark:stroke-violet-400"
							d={`${line.rail} ${line.branches}`}
							strokeLinecap="round"
							strokeWidth={1.75}
						/>
					</g>
				)}
				{talks.map((talk) => (
					<path
						key={talk.key}
						className="fill-none"
						d={talk.d}
						strokeDasharray="1 2.5"
						strokeLinecap="round"
						strokeWidth={1.5}
						style={{
							stroke: `color-mix(in oklab, ${tint(talk.id)} 30%, transparent)`,
						}}
					/>
				))}
				<g clipPath={`url(#${litId})`}>
					{line.subagents
						.filter((each) => !focus || each.id === focus)
						.map((each, index) => (
							<path
								key={`${each.id ?? index}`}
								className="fill-none"
								d={focus && each.id === focus ? each.d : each.edges}
								strokeLinecap="round"
								strokeWidth={1.75}
								style={{
									filter: `drop-shadow(0 0 3px ${tint(each.id)})`,
									stroke: tint(each.id),
								}}
							/>
						))}
					{talks
						.filter((talk) => !focus || talk.id === focus)
						.map((talk) => (
							<path
								key={talk.key}
								className="fill-none"
								d={talk.d}
								strokeDasharray="1 2.5"
								strokeLinecap="round"
								strokeWidth={1.75}
								style={{
									filter: `drop-shadow(0 0 3px ${tint(talk.id)})`,
									stroke: tint(talk.id),
								}}
							/>
						))}
				</g>
				{line.marks.map((mark) => (
					<path
						key={mark.tag}
						className="fill-none"
						d={mark.d}
						strokeLinecap="round"
						strokeWidth={2.75}
						style={{ stroke: railTagTint(mark.tag) }}
					/>
				))}
				{line.errors ? (
					<path
						className="fill-none stroke-rose-500 dark:stroke-rose-400"
						d={line.errors}
						strokeLinecap="round"
						strokeWidth={2.75}
					/>
				) : null}
				{nodes.map((node) => (
					<circle
						key={node.key}
						className={
							node.kind === "subagent"
								? "fill-background"
								: node.alert
									? "fill-rose-500 stroke-rose-500 dark:fill-rose-400 dark:stroke-rose-400"
									: "fill-background stroke-violet-500/60 dark:stroke-violet-400/60"
						}
						style={
							node.kind === "subagent"
								? {
										stroke: `color-mix(in oklab, ${tint(node.id)} 60%, transparent)`,
									}
								: undefined
						}
						cx={node.x}
						cy={node.y}
						r={2.25}
						strokeWidth={1.25}
					/>
				))}
				<g clipPath={`url(#${litId})`}>
					{nodes
						.filter((node) =>
							focus && sessionRef.current
								? node.kind === "subagent" && node.id === focus
								: node.kind !== "subagent",
						)
						.map((node) => {
							const color =
								node.kind === "subagent"
									? tint(node.id)
									: node.alert
										? "var(--color-rose-500)"
										: "var(--color-violet-500)";
							return (
								<circle
									key={`lit:${node.key}`}
									className={node.alert ? undefined : "fill-background"}
									style={{
										fill: node.alert ? color : undefined,
										filter: `drop-shadow(0 0 3px ${color})`,
										stroke: color,
									}}
									cx={node.x}
									cy={node.y}
									r={2.25}
									strokeWidth={1.5}
								/>
							);
						})}
				</g>
				{onFocus ? (
					<g>
						{focus && sessionRef.current ? (
							<path
								className={HIT}
								d={`${line.rail} ${line.branches}`}
								onPointerDown={(event) => {
									event.stopPropagation();
									onFocus(null);
								}}
								style={{
									pointerEvents: "stroke",
									stroke: "var(--color-violet-500)",
								}}
							/>
						) : null}
						{line.subagents
							.filter((each) => each.id && each.id !== focus)
							.map((each) => (
								<path
									key={`hit:${each.id}`}
									className={HIT}
									d={each.d}
									onPointerDown={(event) => {
										event.stopPropagation();
										if (each.id) onFocus(each.id);
									}}
									style={{ pointerEvents: "stroke", stroke: tint(each.id) }}
								/>
							))}
					</g>
				) : null}
			</svg>
			<div
				ref={viewRef}
				className="absolute inset-x-0 top-0 rounded-md bg-white corner-squircle squircle:rounded-xl ring-1 ring-zinc-950/8 hover:ring-zinc-950/15 dark:bg-white/5 dark:ring-white/12 dark:hover:bg-white/8"
			/>
			<MinimapHeads
				focus={focus ?? null}
				member={member}
				model={model}
				parts={parts}
				scale={drawn.scale}
				width={drawn.width}
			/>
		</div>
	);
}
