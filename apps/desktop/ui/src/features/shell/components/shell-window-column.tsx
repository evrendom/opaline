import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The window plus the strip of canvas under it.
 * The column owns the inset's canvas margin, which SidebarInset only applies
 * as the sidebar's direct sibling, so pair it with `shellWindowRadiusClassName`
 * on the inset. */
export function ShellWindowColumn({
	children,
	footer,
}: {
	children: ReactNode;
	/** The strip takes the place of the bottom margin; without one the window
	 *  keeps it. */
	footer?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col md:peer-data-[variant=inset]:mx-2 md:peer-data-[variant=inset]:mt-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
				!footer && "md:peer-data-[variant=inset]:mb-2",
			)}
		>
			{children}
			{footer}
		</div>
	);
}

export const shellWindowRadiusClassName =
	"md:rounded-lg squircle:md:rounded-3xl";

/** Holds the footer's height while there is nothing to show. */
export function ShellWindowFooterPlaceholder() {
	return <div aria-hidden="true" className="h-8 shrink-0" />;
}
