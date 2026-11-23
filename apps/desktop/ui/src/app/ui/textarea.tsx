import type * as React from "react";

import { cn } from "@/lib/utils";
import { FIELD_CLASS_NAME } from "./input";

// Multi-line text: the same field as Input, growing with its content from
// three lines. Single-line text is always an Input, whatever its type.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				FIELD_CLASS_NAME,
				"field-sizing-content min-h-20 w-full min-w-0 py-m",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
