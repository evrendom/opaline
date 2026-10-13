import { cn } from "@/lib/utils";

/** The green dot of a running session; it pulses while the session runs. */
export function LiveSessionDot({ pulsing }: { pulsing: boolean }) {
	return (
		<span aria-hidden="true" className="relative flex size-1.5 shrink-0">
			{pulsing ? (
				<span className="absolute inset-0 animate-ping rounded-full bg-[#22c55e] opacity-60 motion-reduce:animate-none" />
			) : null}
			<span
				className={cn(
					"relative size-1.5 rounded-full",
					pulsing ? "bg-[#22c55e]" : "bg-black/20 dark:bg-white/25",
				)}
			/>
		</span>
	);
}
