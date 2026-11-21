import { IconChevronRight, IconTextWrap } from "@tabler/icons-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";
import { CopyButton } from "@/features/shell/components/copy-button";
import { cn } from "@/lib/utils";
import { ShellOutput } from "./session-reader-shell-output";
import { estimateTokens } from "./session-reader-token-estimate";

const LAYOUT_CHARS = 20_000;

export function sizeHint(value: string): string {
	return value.length >= 1024
		? `${(value.length / 1024).toFixed(1)} KB`
		: `${value.length} chars`;
}

export function tokenHint(
	value: string,
	model: string | null,
): { label: string; title: string } {
	const { charsPerToken, tokenizer, tokens } = estimateTokens(
		value.length,
		model,
	);
	const count =
		tokens >= 1_000
			? `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}K tokens`
			: `${tokens} ${tokens === 1 ? "token" : "tokens"}`;
	return {
		label: `~${count}`,
		title: `About ${tokens.toLocaleString()} tokens, at ${charsPerToken} characters a token (${tokenizer})`,
	};
}

export function ToolCard({
	call,
	collapsible = false,
	command = "",
	fit = false,
	model = null,
	output,
	prose = false,
	scrolls = true,
	wrapLines = false,
}: {
	call?: ReactNode;
	collapsible?: boolean;
	command?: string;
	output: string | null;
	fit?: boolean;
	model?: string | null;
	prose?: boolean;
	scrolls?: boolean;
	wrapLines?: boolean;
}) {
	const [full, setFull] = useState(false);
	const [wrap, setWrap] = useState(wrapLines);
	const [open, setOpen] = useState(true);
	const reduce = useReducedMotion() ?? false;
	const text = output?.trim() ?? "";
	const clipped = !full && text.length > LAYOUT_CHARS;
	const size = tokenHint(text, model);
	return (
		<section
			className={cn(
				"flex min-h-0 flex-col overflow-hidden",
				prose
					? null
					: // design-escape-ok(opacity): no role renders this; bg-field/40
						"edge-m border-line-soft bg-field/40 corner-squircle dark:bg-wash",
				!prose &&
					(fit
						? "corner-l squircle:corner-xl"
						: "flex-1 corner-t-l edge-b-none squircle:corner-t-xl"),
				prose && !fit && "flex-1",
			)}
		>
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col gap-m",
					prose ? "px-xxl" : "px-l pt-l pb-xl",
					scrolls ? "overflow-y-auto" : "overflow-hidden",
				)}
			>
				{call}
				{collapsible && text ? (
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen((value) => !value)}
						className={cn(
							"flex w-fit items-center gap-xs",
							"-mb-xs corner-s px-s py-xs",
							"text-body-s font-medium",
							"text-ink-3 transition-colors",
							"hover:text-ink",
						)}
					>
						<IconChevronRight
							aria-hidden="true"
							className={cn(
								"size-3 transition-transform duration-(--motion-medium-duration)",
								open && "rotate-90",
							)}
						/>
						Result
						<span
							title={size.title}
							className="font-regular text-ink-disabled tabular-nums"
						>
							{size.label}
						</span>
					</button>
				) : null}
				<AnimatePresence initial={false}>
					{text && (!collapsible || open) ? (
						<motion.div
							key="output"
							className={collapsible ? "overflow-hidden" : "contents"}
							initial={collapsible ? { height: 0, opacity: 0 } : false}
							animate={collapsible ? { height: "auto", opacity: 1 } : undefined}
							exit={collapsible ? { height: 0, opacity: 0 } : undefined}
							transition={{
								duration: reduce ? 0 : 0.22,
								ease: [0.32, 0.72, 0, 1],
							}}
						>
							{text ? (
								<div
									className={cn(
										"group/output relative flex flex-col gap-xs",
										!prose && "pb-xs",
									)}
								>
									{prose ? (
										<p className="pr-[calc(var(--space-xxl)*4/3)] text-body-l whitespace-pre-wrap [overflow-wrap:anywhere]">
											{text}
										</p>
									) : text.length <= LAYOUT_CHARS ? (
										<ShellOutput command={command} output={text} wrap={wrap} />
									) : (
										<pre
											className={cn(
												"px-l font-data text-body-m",
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
											className="w-fit px-l text-body-m text-ink-3 hover:text-ink"
										>
											Show all {size.label}
										</button>
									) : null}
									<div
										className={cn(
											"absolute top-0 right-1 flex items-center gap-xxs",
											"corner-s",
											// design-escape-ok(opacity): no role renders this; bg-canvas/80
											"bg-canvas/80 opacity-0 backdrop-blur-sm transition-opacity",
											"group-hover/output:opacity-100 focus-within:opacity-100 has-[[aria-pressed=true]]:opacity-100",
										)}
									>
										{prose ? null : (
											<button
												type="button"
												aria-pressed={wrap}
												title={wrap ? "Don’t wrap lines" : "Wrap lines"}
												onClick={() => setWrap((value) => !value)}
												className={cn(
													"inline-flex size-6 items-center justify-center",
													"corner-xs",
													"text-ink-3 transition-colors",
													"hover:text-ink",
													wrap && "text-ink",
												)}
											>
												<IconTextWrap aria-hidden="true" className="size-3.5" />
											</button>
										)}
										<CopyButton title="Copy output" value={output ?? ""} />
									</div>
								</div>
							) : null}
						</motion.div>
					) : null}
				</AnimatePresence>
				{text ? null : (
					// design-escape-ok(opacity): no role renders this; text-ink-3/60
					<p className="px-l pb-xs text-body-m text-ink-3/60">No output</p>
				)}
			</div>
		</section>
	);
}
