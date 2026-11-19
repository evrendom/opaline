import {
	type RefObject,
	startTransition,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type AttemptShape,
	ReaderLayoutContext,
} from "@/features/sessions/reader/detail/reader-layout";
import { readerScrollerOf } from "@/features/sessions/reader/reader-dom";
import { subagentIdOf } from "@/features/sessions/reader/subagents/session-reader-agent-focus";
import { subagentTalkedTo } from "@/features/sessions/reader/subagents/session-reader-subagent-done";
import type { Attempt } from "./trace-attempts";

const AHEAD = "1200px 0px";

const DRAW_WHOLE_BELOW_STEPS = 150;

const ROW_PX = 46;
const LINE_PX = 23;
const BUBBLE_PAD_PX = 20;
const GAP_PX = 12;

export function useSeenAttempts(
	list: RefObject<HTMLOListElement | null>,
	stepCount: number,
) {
	const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
	const observerRef = useRef<IntersectionObserver | null>(null);
	const waitingRef = useRef(new Set<Element>());
	const listRef = useCallback(
		(element: HTMLOListElement | null) => {
			list.current = element;
			if (!element) return;
			const observer = new IntersectionObserver(
				(entries) => {
					const ids = entries.flatMap((entry) => {
						const id = (entry.target as HTMLElement).dataset.attempt;
						return entry.isIntersecting && id ? [id] : [];
					});
					if (ids.length === 0) return;
					startTransition(() =>
						setSeen((previous) => {
							const fresh = ids.filter((id) => !previous.has(id));
							return fresh.length > 0
								? new Set([...previous, ...fresh])
								: previous;
						}),
					);
				},
				{
					root: readerScrollerOf(element),
					rootMargin: AHEAD,
				},
			);
			observerRef.current = observer;
			for (const waiting of waitingRef.current) observer.observe(waiting);
			return () => {
				observer.disconnect();
				observerRef.current = null;
				list.current = null;
			};
		},
		[list],
	);
	const watch = useCallback((element: HTMLElement | null) => {
		if (!element) return;
		waitingRef.current.add(element);
		observerRef.current?.observe(element);
		return () => {
			waitingRef.current.delete(element);
			observerRef.current?.unobserve(element);
		};
	}, []);
	const whole = stepCount < DRAW_WHOLE_BELOW_STEPS;
	return {
		isSeen: (id: string) => whole || seen.has(id),
		listRef,
		watch,
	};
}

function estimateAttempt(attempt: Attempt) {
	const at = attempt.saidStep ? attempt.steps.indexOf(attempt.saidStep) : -1;
	const lines = Math.max(Math.ceil((attempt.said?.length ?? 40) / 90), 1);
	const bubble = lines * LINE_PX + BUBBLE_PAD_PX;
	const subagents: { endMs: number; id: string | null; top: number }[] = [];
	const talks: { id: string; top: number }[] = [];
	let top = 0;
	attempt.steps.forEach((step, index) => {
		if (index === at) {
			top += GAP_PX + bubble + GAP_PX;
			return;
		}
		if (step.kind === "agent")
			subagents.push({ endMs: step.endMs, id: subagentIdOf(step), top });
		const talkedTo = subagentTalkedTo(step);
		if (talkedTo) talks.push({ id: talkedTo, top });
		top += ROW_PX;
	});
	if (at < 0) top += bubble + GAP_PX;
	return { height: top, subagents, talks };
}

export function AttemptPlaceholder({
	attempt,
	watch,
}: {
	attempt: Attempt;
	watch: (element: HTMLElement | null) => (() => void) | undefined;
}) {
	const shape = useContext(ReaderLayoutContext)?.shapes.get(attempt.id);
	if (shape)
		return (
			<MeasuredPlaceholder attempt={attempt} shape={shape} watch={watch} />
		);
	return <EstimatedPlaceholder attempt={attempt} watch={watch} />;
}

function MeasuredPlaceholder({
	attempt,
	shape,
	watch,
}: {
	attempt: Attempt;
	shape: AttemptShape;
	watch: (element: HTMLElement | null) => (() => void) | undefined;
}) {
	return (
		<li
			ref={watch}
			data-attempt={attempt.id}
			data-attempt-pending=""
			data-start-ms={attempt.startMs}
			className="relative"
			style={{ height: shape.height }}
		>
			{shape.rows.map((row) => (
				<span
					key={row.id}
					data-step-row={row.id}
					data-start-ms={row.startMs || undefined}
					data-step-failed={row.failed ? "" : undefined}
					data-step-tags={row.tags || undefined}
					className="absolute inset-x-0"
					style={{ height: row.height, top: row.top }}
				/>
			))}
			{shape.subagents.map((subagent) => (
				<span
					key={`subagent:${subagent.top}`}
					data-subagent=""
					data-subagent-end-ms={subagent.endMs}
					data-subagent-id={subagent.id}
					data-subagent-until={subagent.until}
					className="absolute inset-x-0"
					style={{ height: subagent.height, top: subagent.top }}
				/>
			))}
			{shape.talks.map((talk) => (
				<span
					key={`talk:${talk.top}`}
					data-talks-to={talk.id}
					className="absolute inset-x-0"
					style={{ height: talk.height, top: talk.top }}
				/>
			))}
		</li>
	);
}

function EstimatedPlaceholder({
	attempt,
	watch,
}: {
	attempt: Attempt;
	watch: (element: HTMLElement | null) => (() => void) | undefined;
}) {
	const { height, subagents, talks } = useMemo(
		() => estimateAttempt(attempt),
		[attempt],
	);
	return (
		<li
			ref={watch}
			data-attempt={attempt.id}
			data-attempt-pending=""
			data-start-ms={attempt.startMs}
			className="relative"
			style={{ height }}
		>
			{subagents.map(({ endMs, id, top }) => (
				<span
					key={top}
					data-subagent=""
					data-subagent-end-ms={endMs}
					data-subagent-id={id ?? undefined}
					className="absolute inset-x-0"
					style={{ height: ROW_PX, top }}
				/>
			))}
			{talks.map(({ id, top }) => (
				<span
					key={`talk:${top}`}
					data-talks-to={id}
					className="absolute inset-x-0"
					style={{ height: ROW_PX, top }}
				/>
			))}
		</li>
	);
}
