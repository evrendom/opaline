import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

const SPRING = { type: "spring", damping: 25, stiffness: 350 } as const;

const places = (digits: string) =>
	[...digits].map((digit, at) => ({ digit, place: digits.length - at }));

function RollingDigits({
	digits,
	direction,
}: {
	digits: string;
	direction: 1 | -1;
}) {
	const still = useReducedMotion() ?? false;
	const shift = still ? 0 : direction * 0.7;
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
						<AnimatePresence mode="popLayout" initial={false}>
							<motion.span
								key={digit}
								initial={{ y: `${shift}em`, opacity: 0, filter: "blur(2px)" }}
								animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
								exit={{ y: `${-shift}em`, opacity: 0, filter: "blur(2px)" }}
								transition={still ? { duration: 0 } : SPRING}
								className="absolute"
							>
								{digit}
							</motion.span>
						</AnimatePresence>
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
