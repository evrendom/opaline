import { IconChevronRight } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { CopyButton } from "@/features/shell/components/copy-button";
import { cn } from "@/lib/utils";
import { HighlightedCode } from "./session-reader-step-payloads";
import { sizeHint } from "./session-reader-tool-card";

const PAYLOAD_PREVIEW_CHARS = 20_000;

export type Payload = {
	hint?: string;
	label: string;
	value: string;
} & (
	| { body: ReactNode; show: "body" }
	| {
			language: string;
			show: "code";
			startLine?: number;
	  }
	| { prose?: boolean; show: "text" }
);

export function PayloadSection({
	className,
	...payload
}: Payload & { className?: string }) {
	const { hint, label, value } = payload;
	const [open, setOpen] = useState(true);
	const [full, setFull] = useState(false);
	const clipped = !full && value.length > PAYLOAD_PREVIEW_CHARS;
	return (
		<div className={cn("flex flex-col gap-m px-xxl", className)}>
			<div className="flex items-center justify-between">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
					className={cn(
						"flex min-w-0 items-center gap-s",
						"text-body-m",
						"text-ink-3 transition-colors",
						"hover:text-ink",
					)}
				>
					<IconChevronRight
						aria-hidden="true"
						className={cn("size-3 transition-transform", open && "rotate-90")}
					/>
					{label}
					<span className="text-ink-3/60 tabular-nums">
						{hint ?? sizeHint(value)}
					</span>
				</button>
				<CopyButton value={value} title={`Copy ${label.toLowerCase()}`} />
			</div>
			{open && payload.show === "body" ? payload.body : null}
			{open && payload.show === "code" ? (
				<HighlightedCode
					code={clipped ? value.slice(0, PAYLOAD_PREVIEW_CHARS) : value}
					language={payload.language}
					startLine={payload.startLine}
				/>
			) : null}
			{open && payload.show === "text" ? (
				<pre
					className={cn(
						"corner-s bg-field p-l whitespace-pre-wrap [overflow-wrap:anywhere]",
						payload.prose ? "font-body text-body-l" : "text-body-m",
					)}
				>
					{clipped ? `${value.slice(0, PAYLOAD_PREVIEW_CHARS)}…` : value}
				</pre>
			) : null}
			{open && payload.show !== "body" && clipped ? (
				<button
					type="button"
					onClick={() => setFull(true)}
					className="w-fit text-body-m text-ink-3 hover:text-ink"
				>
					Show all {sizeHint(value)}
				</button>
			) : null}
		</div>
	);
}
