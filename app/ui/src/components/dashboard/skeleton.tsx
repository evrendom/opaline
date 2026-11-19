import type { CSSProperties } from "react";
import { Skeleton as Bar } from "@/app/ui/skeleton";
import { cn } from "@/lib/utils";

function Skeleton({
	className,
	style,
}: {
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<Bar
			className={cn(
				"rounded-md squircle:rounded-2xl corner-squircle",
				className,
			)}
			style={style}
		/>
	);
}

export { Skeleton };
