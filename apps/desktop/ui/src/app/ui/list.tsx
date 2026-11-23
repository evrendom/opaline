import type * as React from "react";

import { cn } from "@/lib/utils";

// Rows of things, with a hairline between them: the rules on a page, the
// members of a workspace, the runs of a check. Inside a Card it's the card's
// content; on the page it stands alone. A row lays its own content out
// (name, meta, a Badge, a menu) with `flex` placement classes.
function List({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="list"
			className={cn(
				"flex min-w-0 flex-col [&>li+li]:edge-t-m [&>li+li]:border-line",
				className,
			)}
			{...props}
		/>
	);
}

function ListItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="list-item"
			className={cn("flex min-w-0 items-center gap-l py-l", className)}
			{...props}
		/>
	);
}

export { List, ListItem };
