import {
	CopyIcon,
	useCopyFeedback,
} from "@/features/shell/components/copy-button";
import "./self-hosted.css";

export function SelfHostedCommand({
	command,
	label,
}: {
	command: string;
	label: string;
}) {
	const { copied, copy } = useCopyFeedback(command);
	return (
		<div className="self-hosted-command">
			<pre>
				<code>{command}</code>
			</pre>
			<button
				type="button"
				className="self-hosted-command-copy copy-button"
				data-copied={copied ? "true" : undefined}
				aria-label={copied ? `${label} copied` : `Copy ${label}`}
				onClick={() => void copy()}
			>
				<CopyIcon className="size-4" />
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}
