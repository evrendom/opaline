import { Button } from "@/app/ui/button";

/**
 * "Try again" after a load failed: an outline button that reads "Trying
 * again…" while the retry runs. For a retry inside a sentence use
 * `<Button variant="link" size="inline">` instead.
 */
export function RetryButton({
	onRetry,
	retrying = false,
	className,
}: {
	onRetry: () => void;
	retrying?: boolean;
	className?: string;
}) {
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className={className}
			disabled={retrying}
			onClick={onRetry}
		>
			{retrying ? "Trying again…" : "Try again"}
		</Button>
	);
}
