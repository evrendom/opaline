import { type ReactNode, useRef } from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import {
	type UseFluidHoverReturn,
	useFluidHover,
} from "@/hooks/use-fluid-hover";

type SessionHoverRegistration = Pick<
	UseFluidHoverReturn,
	"registerItem" | "setActiveIndex"
>;

function isSessionDisabled(element: HTMLElement) {
	return element.dataset.sessionDisabled === "true";
}

export function SessionsOverviewFluidList({
	children,
}: {
	children: (registration: SessionHoverRegistration) => ReactNode;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(containerRef, {
		axis: "y",
		isItemDisabled: isSessionDisabled,
		// The empty area below the table must not open the last session.
		gapClick: { maxDistance: 4 },
	});

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Delegates hover and focus from the native links/buttons; the wrapper is not a separate control.
		<div
			ref={containerRef}
			className="relative isolate flex-1"
			data-slot="sessions-fluid-hover"
			{...hover.handlers}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					hover.setActiveIndex(null);
				}
			}}
		>
			<FluidHoverHighlight
				hover={hover}
				className="z-0 rounded-none bg-(--session-overview-hover)"
			/>
			<ul aria-label="Recent sessions" className="list-none">
				{children(hover)}
			</ul>
		</div>
	);
}
