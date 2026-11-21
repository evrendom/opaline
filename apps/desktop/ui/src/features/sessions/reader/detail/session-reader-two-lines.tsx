import { type ReactNode, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

export function TwoLines({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const measure = useCallback(
		(node: HTMLDivElement | null) => {
			if (!node || expanded) return;
			const observer = new ResizeObserver(() =>
				setOverflows(node.scrollHeight > node.clientHeight + 1),
			);
			observer.observe(node);
			return () => observer.disconnect();
		},
		[expanded],
	);
	const folded = !expanded && overflows;
	return (
		<div className="flex min-w-0 flex-col items-start gap-s">
			<div
				ref={measure}
				className={cn(
					"w-full",
					!expanded && "max-h-[2lh] overflow-hidden",
					folded &&
						"[mask-image:linear-gradient(to_bottom,black_40%,transparent)]",
					className,
				)}
			>
				{children}
			</div>
			{overflows || expanded ? (
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					className="text-body-m text-ink-3 focus-outline hover:text-ink"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			) : null}
		</div>
	);
}
