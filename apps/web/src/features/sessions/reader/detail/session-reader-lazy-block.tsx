import { type ReactNode, useLayoutEffect, useState } from "react";

const MARGIN = "1200px 0px";

const heights = new Map<string, number>();

export function LazyBlock({
	children,
	eager = false,
	estimate,
	id,
}: {
	children: () => ReactNode;
	eager?: boolean;
	estimate: number;
	id: string;
}) {
	const [node, setNode] = useState<HTMLDivElement | null>(null);
	const [near, setNear] = useState(eager);
	useLayoutEffect(() => {
		if (!node) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry) return;
				if (!entry.isIntersecting && node.firstElementChild)
					heights.set(id, node.getBoundingClientRect().height);
				setNear(entry.isIntersecting);
			},
			{
				root: node.parentElement?.closest("[data-lazy-root]") ?? null,
				rootMargin: MARGIN,
			},
		);
		observer.observe(node);
		return () => {
			if (node.firstElementChild)
				heights.set(id, node.getBoundingClientRect().height);
			observer.disconnect();
		};
	}, [node, id]);
	return (
		<div
			ref={setNode}
			style={near ? undefined : { height: heights.get(id) ?? estimate }}
		>
			{near ? children() : null}
		</div>
	);
}

export function lineCount(text: string | null | undefined): number {
	if (!text) return 0;
	let lines = 1;
	for (
		let index = text.indexOf("\n");
		index >= 0;
		index = text.indexOf("\n", index + 1)
	)
		lines++;
	return lines;
}
