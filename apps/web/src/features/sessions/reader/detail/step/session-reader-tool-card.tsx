import { IconTextWrap } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { CopyButton } from "@/features/shell/components/copy-button";
import { cn } from "@/lib/utils";
import { ShellOutput } from "./session-reader-shell-output";

const LAYOUT_CHARS = 20_000;

export function sizeHint(value: string): string {
	return value.length >= 1024
		? `${(value.length / 1024).toFixed(1)} KB`
		: `${value.length} chars`;
}

export function ToolCard({
	call,
	command = "",
	fit = false,
	output,
	prose = false,
	scrolls = true,
}: {
	call?: ReactNode;
	command?: string;
	output: string | null;
	fit?: boolean;
	prose?: boolean;
	scrolls?: boolean;
}) {
	const [full, setFull] = useState(false);
	const [wrap, setWrap] = useState(false);
	const text = output?.trim() ?? "";
	const clipped = !full && text.length > LAYOUT_CHARS;
	return (
		<section
			className={cn(
				"flex min-h-0 flex-col overflow-hidden",
				prose
					? null
					: "border border-border/60 bg-muted/40 corner-squircle dark:bg-white/[0.02]",
				!prose &&
					(fit
						? "rounded-xl squircle:rounded-3xl"
						: "flex-1 rounded-t-xl border-b-0 squircle:rounded-t-3xl"),
				prose && !fit && "flex-1",
			)}
		>
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col gap-2",
					prose ? "px-5" : "px-3 pt-3 pb-4",
					scrolls ? "overflow-y-auto" : "overflow-hidden",
				)}
			>
				{call}
				{text ? (
					<div
						className={cn(
							"group/output relative flex flex-col gap-1",
							!prose && "pb-1",
						)}
					>
						{prose ? (
							<p className="pr-8 text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
								{text}
							</p>
						) : text.length <= LAYOUT_CHARS ? (
							<ShellOutput command={command} output={text} wrap={wrap} />
						) : (
							<pre
								className={cn(
									"px-3 font-mono text-xs leading-5",
									wrap
										? "whitespace-pre-wrap [overflow-wrap:anywhere]"
										: "overflow-x-auto whitespace-pre",
								)}
							>
								{clipped ? `${text.slice(0, LAYOUT_CHARS)}…` : text}
							</pre>
						)}
						{clipped ? (
							<button
								type="button"
								onClick={() => setFull(true)}
								className="w-fit cursor-pointer px-3 text-xs text-muted-foreground hover:text-foreground"
							>
								Show all {sizeHint(text)}
							</button>
						) : null}
						<div className="absolute top-0 right-1 flex items-center gap-0.5 rounded-md bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover/output:opacity-100 focus-within:opacity-100 has-[[aria-pressed=true]]:opacity-100">
							{prose ? null : (
								<button
									type="button"
									aria-pressed={wrap}
									title={wrap ? "Don’t wrap lines" : "Wrap lines"}
									onClick={() => setWrap((value) => !value)}
									className={cn(
										"inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground",
										wrap && "text-foreground",
									)}
								>
									<IconTextWrap aria-hidden="true" className="size-3.5" />
								</button>
							)}
							<CopyButton title="Copy output" value={output ?? ""} />
						</div>
					</div>
				) : (
					<p className="px-3 pb-1 text-xs text-muted-foreground/60">
						No output
					</p>
				)}
			</div>
		</section>
	);
}
