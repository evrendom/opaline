import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useMemo,
	useRef,
} from "react";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import {
	type UseFluidHoverReturn,
	useFluidHover,
	useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { cn } from "@/lib/utils";

export type FluidListItems = Pick<
	UseFluidHoverReturn,
	"registerItem" | "setActiveIndex"
>;

const FluidListContext = createContext<FluidListItems | null>(null);

export function FluidList({
	axis = "y",
	children,
	className,
	highlightClassName,
}: {
	axis?: "x" | "y" | "xy";
	children: ReactNode;
	className?: string;
	highlightClassName?: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(containerRef, {
		axis,
		gapClick: false,
		reflectActiveState: false,
	});
	const { registerItem, setActiveIndex } = hover;
	const items = useMemo(
		() => ({ registerItem, setActiveIndex }),
		[registerItem, setActiveIndex],
	);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Delegates hover and focus from the native row controls.
		<div
			ref={containerRef}
			className={cn("relative isolate", className)}
			{...hover.handlers}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget))
					setActiveIndex(null);
			}}
		>
			<FluidHoverHighlight
				hover={hover}
				className={cn(
					"z-0 corner-s bg-hover corner-squircle squircle:corner-l",
					highlightClassName,
				)}
			/>
			<FluidListContext.Provider value={items}>
				{children}
			</FluidListContext.Provider>
		</div>
	);
}

export function useFluidListRegistry(): FluidListItems | null {
	return useContext(FluidListContext);
}

export function useFluidListItem<T extends HTMLElement>(
	index: number | undefined,
): { ref: RefObject<T | null>; onFocus: () => void } {
	const items = useContext(FluidListContext);
	const ref = useRef<T>(null);
	useRegisterFluidHoverItem(items?.registerItem, index, ref);
	return {
		ref,
		onFocus: () => {
			if (index !== undefined) items?.setActiveIndex(index);
		},
	};
}

export function FluidListItem<T extends HTMLElement>({
	children,
	index,
}: {
	children: (item: {
		ref: RefObject<T | null>;
		onFocus: () => void;
	}) => ReactNode;
	index: number | undefined;
}) {
	return children(useFluidListItem<T>(index));
}
