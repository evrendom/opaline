import { cn } from "@/lib/utils";

/**
 * Grows a small control's hit area to at least 48px on touch screens, without
 * changing its layout. Place it inside a `relative` control (Button is). Fine
 * pointers (mouse, trackpad) never see it.
 */
export function TouchTarget({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			data-slot="touch-target"
			className={cn(
				"absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden",
				className,
			)}
		/>
	);
}
