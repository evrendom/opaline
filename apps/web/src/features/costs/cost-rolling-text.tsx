import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const SPRING = { type: "spring", damping: 25, stiffness: 350 } as const;
const LEAVE_LIMIT_MS = 1_000;

const places = (digits: string) =>
	[...digits].map((digit, at) => ({ digit, place: digits.length - at }));

type Shown = { digit: string; id: number; direction: 1 | -1 };
export type DigitsState = { shown: Shown; leaving: Shown[] };

export function nextDigits(
	state: DigitsState,
	digit: string,
	direction: 1 | -1,
) {
	if (state.shown.digit === digit) return state;
	return {
		shown: { digit, id: state.shown.id + 1, direction },
		leaving: [...state.leaving, { ...state.shown, direction }],
	};
}

function DigitSlot({
	digit,
	direction,
	still,
}: {
	digit: string;
	direction: 1 | -1;
	still: boolean;
}) {
	const [state, setState] = useState<DigitsState>({
		shown: { digit, id: 0, direction },
		leaving: [],
	});
	const next = nextDigits(state, digit, direction);
	if (next !== state) setState(next);
	const { shown, leaving } = next;
	const newest = leaving.at(-1)?.id;
	useEffect(() => {
		if (newest === undefined) return;
		const timer = setTimeout(
			() =>
				setState((current) => ({
					...current,
					leaving: current.leaving.filter((left) => left.id > newest),
				})),
			LEAVE_LIMIT_MS,
		);
		return () => clearTimeout(timer);
	}, [newest]);
	const shift = (step: Shown) => (still ? 0 : step.direction * 0.7);
	const transition = still ? { duration: 0 } : SPRING;
	return (
		<>
			{leaving.map((step) => (
				<motion.span
					key={step.id}
					aria-hidden="true"
					initial={{ y: 0, opacity: 1, filter: "blur(0px)" }}
					animate={{ y: `${-shift(step)}em`, opacity: 0, filter: "blur(2px)" }}
					transition={transition}
					onAnimationComplete={() =>
						setState((current) => ({
							...current,
							leaving: current.leaving.filter((left) => left.id !== step.id),
						}))
					}
					className="pointer-events-none absolute"
				>
					{step.digit}
				</motion.span>
			))}
			<motion.span
				key={shown.id}
				initial={
					shown.id === 0
						? false
						: { y: `${shift(shown)}em`, opacity: 0, filter: "blur(2px)" }
				}
				animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
				transition={transition}
				className="absolute"
			>
				{shown.digit}
			</motion.span>
		</>
	);
}

function RollingDigits({
	digits,
	direction,
}: {
	digits: string;
	direction: 1 | -1;
}) {
	const still = useReducedMotion() ?? false;
	return (
		<span className="inline-flex">
			<AnimatePresence mode="popLayout" initial={false}>
				{places(digits).map(({ digit, place }) => (
					<motion.span
						key={place}
						initial={{ width: 0, opacity: 0 }}
						animate={{ width: "0.62em", opacity: 1 }}
						exit={{ width: 0, opacity: 0 }}
						transition={{ duration: still ? 0 : 0.12 }}
						className="relative inline-flex h-[1.2em] items-center justify-center"
					>
						<DigitSlot digit={digit} direction={direction} still={still} />
					</motion.span>
				))}
			</AnimatePresence>
		</span>
	);
}

const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

export function amountOf(text: string) {
	const match = text.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([kmb])?/i);
	if (!match?.[1]) return Number.NaN;
	return Number(match[1]) * (SCALE[match[2]?.toLowerCase() ?? ""] ?? 1);
}

export function RollingText({
	text,
	direction: fallback = 1,
}: {
	text: string;
	direction?: 1 | -1;
}) {
	const [last, setLast] = useState({ text, direction: fallback });
	if (last.text !== text) {
		const before = amountOf(last.text);
		const after = amountOf(text);
		setLast({
			text,
			direction:
				Number.isFinite(before) && Number.isFinite(after) && before !== after
					? after > before
						? 1
						: -1
					: fallback,
		});
	}
	const direction = last.direction;
	const parts = text.split(/(\d+)/).filter(Boolean);
	return (
		<span className="inline-flex items-center whitespace-pre tabular-nums">
			{parts.map((part, at) =>
				/^\d+$/.test(part) ? (
					<RollingDigits
						key={`digits-${parts.slice(0, at).join("").length}`}
						digits={part}
						direction={direction}
					/>
				) : (
					<span key={`text-${parts.slice(0, at).join("").length}`}>{part}</span>
				),
			)}
		</span>
	);
}
