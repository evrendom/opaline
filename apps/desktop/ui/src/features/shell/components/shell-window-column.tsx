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
				"flex min-h-0 min-w-0 flex-1 flex-col md:peer-data-[variant=inset]:mx-m md:peer-data-[variant=inset]:mt-m md:peer-data-[variant=inset]:ml-zero md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-m",
				!footer && "md:peer-data-[variant=inset]:mb-m",
			)}
		>
			{children}
			{footer}
		</div>
	);
}

export const shellWindowRadiusClassName = "md:corner-m squircle:md:corner-xl";

/** Holds the footer's height while there is nothing to show. */
export function ShellWindowFooterPlaceholder() {
	return <div aria-hidden="true" className="h-8 shrink-0" />;
}
