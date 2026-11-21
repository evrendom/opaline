import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { jumpNearThenEaseTo } from "./reader-jump-scroll";

// A floating pill pointing to what's active but scrolled out of sight — the
// step the pane shows, the turn the rail marks — with its icon and an arrow
// toward it; clicking it scrolls there.

/** Where a thing sits against what shows it: out of sight above or below,
 * or (null) in sight. */
export type Offscreen = "above" | "below" | null;

/** Whether `box` lies wholly outside the band from `top` to `bottom`. */
export function getOffscreen(
	box: DOMRect,
	top: number,
	bottom: number,
): Offscreen {
	if (box.bottom <= top) return "above";
	if (box.top >= bottom) return "below";
	return null;
}

/**
 * `measure()` kept current as anything scrolls or the window resizes, and
 * whenever `key` — what's being pointed to — changes. Measured in a frame,
 * and re-rendering only when the answer changes.
 */
export function useOffscreen(measure: () => Offscreen, key: string): Offscreen {
	const [where, setWhere] = useState<Offscreen>(null);
	const measureRef = useRef(measure);
	measureRef.current = measure;
	// biome-ignore lint/correctness/useExhaustiveDependencies: key names the thing measured, so a new one measures afresh
	useLayoutEffect(() => {
		let frame = 0;
		const sync = () => {
			frame = 0;
			setWhere(measureRef.current());
		};
		sync();
		const onChange = () => {
			if (!frame) frame = requestAnimationFrame(sync);
		};
		document.addEventListener("scroll", onChange, {
			capture: true,
			passive: true,
		});
		window.addEventListener("resize", onChange);
		return () => {
			document.removeEventListener("scroll", onChange, { capture: true });
			window.removeEventListener("resize", onChange);
			cancelAnimationFrame(frame);
		};
	}, [key]);
	return where;
}

/** The side the thing was last out of sight on — where the pill sits, and
 * which way it points — held while it fades out once back in sight. */
export function useLastOffscreen(where: Offscreen): Exclude<Offscreen, null> {
	const [last, setLast] = useState<Exclude<Offscreen, null>>("below");
	if (where && where !== last) setLast(where);
	return where ?? last;
}

export function scrollToCenter(
	scroller: HTMLElement,
	target: HTMLElement,
	at = 0.5,
) {
	jumpNearThenEaseTo(scroller, target, at);
}

/** The pill — on the mode's own surface, with the shadow the chips wear —
 * holding an icon and an arrow, easing in from the edge it sits on while
 * `where` points somewhere, out while it's null. */
export function JumpPill({
	icon,
	label,
	onClick,
	where,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	where: Offscreen;
}) {
	const side = useLastOffscreen(where);
	const Arrow = side === "above" ? IconArrowUp : IconArrowDown;
	return (
		<button
			type="button"
			aria-hidden={where ? undefined : true}
			aria-label={label}
			tabIndex={where ? undefined : -1}
			title={label}
			onClick={onClick}
			className={cn(
				"flex h-8 items-center gap-s",
				"corner-full pr-[calc(var(--space-m)+var(--space-xxs))] pl-s",
				"bg-canvas text-ink-3 shadow-card transition-[opacity,translate,color] duration-(--motion-medium-duration) ease-base",
				"focus-outline hover:text-ink dark:bg-card",
				where
					? "pointer-events-auto translate-y-0 opacity-100"
					: cn(
							"pointer-events-none opacity-0",
							side === "above" ? "-translate-y-1" : "translate-y-1",
						),
			)}
		>
			{icon}
			<Arrow aria-hidden="true" className="size-4" />
		</button>
	);
}
