import { type CSSProperties, useEffect, useLayoutEffect, useRef } from "react";
import { SkeletonBox } from "skullet/react";
import { cn } from "@/lib/utils";
import { cancelSkulletAnimations } from "./skullet-animations";

const SIZED_BY_CLASS: CSSProperties = {
	borderRadius: undefined,
	height: undefined,
	width: undefined,
};

type Attributes = Record<`aria-${string}` | `data-${string}`, unknown>;

function Skeleton({
	className,
	style,
	...attributes
}: {
	className?: string;
	style?: CSSProperties;
} & Partial<Attributes>) {
	const host = useRef<HTMLSpanElement>(null);
	const forwarded = JSON.stringify({ "data-slot": "skeleton", ...attributes });
	useLayoutEffect(() => {
		const bar = host.current?.querySelector<HTMLElement>("[skullet-bar]");
		if (!bar) return;
		const entries = Object.entries(JSON.parse(forwarded) as Attributes);
		for (const [name, value] of entries)
			if (value === false || value == null) bar.removeAttribute(name);
			else bar.setAttribute(name, value === true ? "" : String(value));
	}, [forwarded]);
	useEffect(() => {
		if (!host.current) return;
		return cancelSkulletAnimations(host.current);
	}, []);
	return (
		<span ref={host} className="contents">
			<SkeletonBox
				className={cn("corner-xl", className)}
				style={{ ...SIZED_BY_CLASS, ...style }}
			/>
		</span>
	);
}

export { Skeleton };
