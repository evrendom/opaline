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
					// design-escape-ok(radius): shipped value; a 20px squircle
					"p-m corner-m corner-squircle squircle:rounded-[20px] bg-surface shadow-card",
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
