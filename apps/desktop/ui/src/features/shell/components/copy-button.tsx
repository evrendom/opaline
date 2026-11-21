import { useId, useRef, useState } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import "./copy-button.css";

// Matches the marketing site's copy feedback hold.
const COPY_FEEDBACK_MS = 2000;

/**
 * Copies a value and holds the copied state for the marketing site's feedback
 * window. Put `copy-button` and `data-copied` on the element that wraps the
 * `CopyIcon` so its animation plays.
 */
export function useCopyFeedback(value: string) {
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<number | undefined>(undefined);
	useMountEffect(() => () => window.clearTimeout(copyTimer.current));

	async function copy() {
		if (!(await copyTextToClipboard(value))) return;
		window.clearTimeout(copyTimer.current);
		setCopied(true);
		copyTimer.current = window.setTimeout(
			() => setCopied(false),
			COPY_FEEDBACK_MS,
		);
	}

	return { copied, copy };
}

// The marketing site's copy icon: the two squares merge into a circle and a
// check draws inside it while the nearest `.copy-button` is copied.
export function CopyIcon({ className }: { className?: string }) {
	const maskId = useId();

	return (
		<svg
			className={cn("copy-icon", className)}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<rect
				className="copy-icon-lower"
				x="4.75"
				y="8.75"
				width="10.5"
				height="10.5"
				rx="2"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<g mask={`url(#${maskId})`}>
				<rect
					className="copy-icon-upper"
					x="8.75"
					y="4.75"
					width="10.5"
					height="10.5"
					rx="2"
					stroke="currentColor"
					strokeWidth="1.5"
				/>
			</g>
			<path
				className="copy-icon-check"
				d="M9.25 12.25L11 14.25L15 10"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				pathLength="1"
			/>
			<mask id={maskId} maskUnits="userSpaceOnUse">
				<rect width="24" height="24" fill="#fff" />
				<rect
					className="copy-icon-mask-shape"
					x="4.75"
					y="8.75"
					width="10.5"
					height="10.5"
					rx="2"
					fill="#000"
					stroke="#000"
					strokeWidth="1.5"
				/>
			</mask>
		</svg>
	);
}

// Copies a value with the marketing site's copy icon animation.
export function CopyButton({
	value,
	title,
	className,
}: {
	value: string;
	title: string;
	className?: string;
}) {
	const { copied, copy } = useCopyFeedback(value);

	return (
		<button
			type="button"
			title={title}
			aria-label={copied ? "Copied" : title}
			data-copied={copied ? "true" : undefined}
			onClick={() => void copy()}
			className={cn(
				"copy-button inline-flex shrink-0 items-center justify-center",
				// design-escape-ok(radius): shipped value; 4px corner
				"rounded-[4px] p-xs",
				// design-escape-ok(opacity): no role renders this; ink-3 at 60%
				"text-ink-3/60 transition-colors focus-outline",
				"hover:text-ink",
				className,
			)}
		>
			<CopyIcon className="size-4.5" />
		</button>
	);
}
