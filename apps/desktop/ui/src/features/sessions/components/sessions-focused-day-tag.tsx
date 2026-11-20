import { IconCalendarEvent, IconX } from "@tabler/icons-react";
import { format, parseISO } from "date-fns";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/app/ui/button";
import { FlowFigure } from "@/app/ui/flow-number";
import { type DotPick, useDotPick } from "@/features/costs/cost-hover-date";
import { textFigure } from "@/lib/figure";

const ENTER = { duration: 0.46, ease: [0.22, 1, 0.36, 1] } as const;

export function dayLabel(pick: DotPick) {
	const start = parseISO(pick.date);
	if (pick.date === pick.end) return format(start, "MMM d");
	return `${format(start, "MMM d")} – ${format(parseISO(pick.end), "MMM d")}`;
}

export function SessionsFocusedDayTag() {
	const dotPick = useDotPick();
	const reduceMotion = useReducedMotion();
	const picked = dotPick?.picked ?? null;
	return (
		<AnimatePresence initial={false}>
			{picked ? (
				<Button
					key="focused-day"
					type="button"
					variant="toolbar"
					aria-pressed="true"
					title="Show every day again"
					aria-label={`Showing ${dayLabel(picked)} only. Show every day again`}
					onClick={() => dotPick?.pick(null)}
					nativeButton
					render={
						<motion.button
							initial={{ opacity: 0, filter: "blur(2px)", scale: 0.96 }}
							animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
							exit={{ opacity: 0, filter: "blur(2px)", scale: 0.96 }}
							transition={reduceMotion ? { duration: 0 } : ENTER}
						/>
					}
				>
					<IconCalendarEvent aria-hidden="true" />
					<FlowFigure figure={textFigure(dayLabel(picked))} />
					<IconX aria-hidden="true" className="text-ink-3" />
				</Button>
			) : null}
		</AnimatePresence>
	);
}
