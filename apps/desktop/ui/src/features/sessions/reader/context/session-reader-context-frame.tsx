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
					"p-m corner-m corner-squircle squircle:corner-xl bg-card shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_1px_-1px_rgba(0,0,0,0.1),0_1px_2px_0_rgba(0,0,0,0.05)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.1)]",
				className,
			)}
		>
			{head ? (
				<div data-context-pick="" className="px-s pt-s pb-l">
					{head}
				</div>
			) : null}
			{children}
		</div>
	);
}
