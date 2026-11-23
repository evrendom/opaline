import type * as React from "react";

import { cn } from "@/lib/utils";

// A whole surface that is clickable: a list row, a tile, a chart bar, a
// disclosure. It brings the button semantics, the keyboard focus mark and
// the disabled state, and no look of its own: the row or tile it wraps owns
// that. Anything shaped like a button is a Button, never a Pressable.
function Pressable({
	className,
	type = "button",
	...props
}: React.ComponentProps<"button">) {
	return (
		<button
			type={type}
			data-slot="pressable"
			className={cn(
				"cursor-default appearance-none text-left text-inherit focus-outline",
				"disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { Pressable };
