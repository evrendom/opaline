import { type ReactNode, useContext } from "react";
import { cn } from "@/lib/utils";
import { ContextMapHead, ContextPreview } from "./session-reader-context-head";

export function ContextMapFrame({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const head = useContext(ContextMapHead);
	const preview = useContext(ContextPreview);
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col",
				!preview &&
					"p-2 rounded-[10px] corner-squircle squircle:rounded-[20px] bg-card shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_1px_-1px_rgba(0,0,0,0.1),0_1px_2px_0_rgba(0,0,0,0.05)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.1)]",
				className,
			)}
		>
			{head ? (
				<div data-context-pick="" className="px-1.5 pt-1.5 pb-3">
					{head}
				</div>
			) : null}
			{children}
		</div>
	);
}
