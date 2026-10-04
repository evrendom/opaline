import { AnimatePresence, animate, motion } from "motion/react";
import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

/**
 * Entrance motion is CSS-driven so the server-rendered markup is already the
 * final state. The one thing CSS cannot do is count a number up, so values
 * only count on charts mounted after hydration (tab switches), never on the
 * first paint.
 */
const LiveMotionContext = createContext<RefObject<boolean>>({ current: false });

export function TrendsMotionProvider({ children }: { children: ReactNode }) {
	const live = useRef(false);
	useEffect(() => {
		live.current = true;
	}, []);
	return <LiveMotionContext value={live}>{children}</LiveMotionContext>;
}

/** Whether the page has hydrated: charts mounted after it may animate in. */
export function useLiveMotion() {
	return useContext(LiveMotionContext);
}

/** Rows gliding to a new place (the model list, a ranking re-sorted): the
 * chart's glide between views, in length and easing. */
export const ROW_GLIDE = { duration: 0.56, ease: [0.32, 0.72, 0, 1] } as const;

export const TRENDS_SPRING = {
	type: "spring",
	stiffness: 380,
	damping: 36,
	mass: 0.9,
} as const;

export function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AnimatedValue({
	value,
	format,
	from = 0,
}: {
	readonly value: number;
	readonly format: (value: number) => string;
	/** Where an entrance counts from: zero, or the chart's own start (an
	 * even split swells from 50%). */
	readonly from?: number;
}) {
	const live = useContext(LiveMotionContext);
	const [shown, setShown] = useState(value);
	// The number on screen: an entrance counts up from zero, every change
	// after it from what is already shown (mid-count included).
	const current = useRef<number | null>(null);
	useEffect(() => {
		if (!live.current || prefersReducedMotion()) {
			current.current = value;
			setShown(value);
			return;
		}
		const controls = animate(current.current ?? from, value, {
			duration: 0.7,
			ease: [0.2, 0.8, 0.2, 1],
			onUpdate: (latest) => {
				current.current = latest;
				setShown(latest);
			},
		});
		return () => controls.stop();
	}, [value, live, from]);
	return <>{format(shown)}</>;
}

/**
 * A position across a plot (0 to 1) that glides to each new value, so what
 * marks the inspected day (the dot, its line, its date) travels instead of
 * jumping. Before hydration and with reduced motion it jumps.
 */
export function useGlide(target: number) {
	const live = useContext(LiveMotionContext);
	const [shown, setShown] = useState(target);
	const current = useRef(target);
	useEffect(() => {
		if (!live.current || prefersReducedMotion()) {
			current.current = target;
			setShown(target);
			return;
		}
		const controls = animate(current.current, target, {
			duration: 0.22,
			ease: [0.22, 1, 0.36, 1],
			onUpdate: (latest) => {
				current.current = latest;
				setShown(latest);
			},
		});
		return () => controls.stop();
	}, [target, live]);
	return shown;
}

/**
 * Two charts of one question (Usage's share by model and by harness) in
 * one place: switching fades the old one out and the new one in, its own
 * entrance playing as it appears, instead of cutting from one to the other.
 */
export function ChartCrossfade({
	id,
	children,
}: {
	/** Which chart is shown; a new id cross-fades to it. */
	readonly id: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="trends-chart-stack">
			<AnimatePresence initial={false}>
				<motion.div
					key={id}
					className="trends-chart-layer"
					initial={{ opacity: 0 }}
					// The old chart is nearly gone before the new one shows, so
					// their axes never read on top of each other.
					animate={{
						opacity: 1,
						transition: {
							duration: 0.3,
							delay: 0.12,
							ease: [0.22, 1, 0.36, 1],
						},
					}}
					exit={{
						opacity: 0,
						transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
					}}
				>
					{children}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
