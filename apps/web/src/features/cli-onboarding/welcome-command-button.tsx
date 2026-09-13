import { useEffect, useRef, useState } from "react";
import { InstallCommandButton } from "../../../../marketing/src/components/install-command-button";

export function WelcomeCommandButton({
	displayCommand,
	onCopy,
}: {
	displayCommand: string;
	onCopy: () => Promise<boolean>;
}) {
	const [copying, setCopying] = useState(false);
	const [copied, setCopied] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [error, setError] = useState(false);
	const feedbackTimer = useRef<number | undefined>(undefined);
	const resetTimer = useRef<number | undefined>(undefined);
	useEffect(() => {
		return () => {
			window.clearTimeout(feedbackTimer.current);
			window.clearTimeout(resetTimer.current);
		};
	}, []);

	async function copy() {
		if (copying) return;
		setCopying(true);
		setError(false);
		try {
			const success = await onCopy();
			setError(!success);
			if (success) {
				window.clearTimeout(feedbackTimer.current);
				window.clearTimeout(resetTimer.current);
				setResetting(false);
				setCopied(true);
				feedbackTimer.current = window.setTimeout(() => {
					setCopied(false);
					setResetting(true);
					resetTimer.current = window.setTimeout(
						() => setResetting(false),
						250,
					);
				}, 2000);
			}
		} catch {
			setError(true);
		} finally {
			setCopying(false);
		}
	}
	return (
		<>
			<InstallCommandButton
				className="cli-welcome-command"
				command={displayCommand}
				data-copied={copied ? "true" : undefined}
				data-copy-resetting={resetting ? "true" : undefined}
				disabled={copying}
				aria-label={
					copied
						? "Copied — paste in your terminal"
						: `Copy setup command: ${displayCommand}`
				}
				onClick={() => void copy()}
				title={
					copied ? "Copied — paste in your terminal" : "Copy setup command"
				}
				onPointerMove={(event) => {
					const glow = event.currentTarget.querySelector<HTMLElement>(
						"[data-instant-v2-pointer-glow-effect]",
					);
					const bounds = event.currentTarget.getBoundingClientRect();
					glow?.style.setProperty(
						"--instant-v2-glow-x",
						`${event.clientX - (bounds.left + bounds.width / 2)}px`,
					);
					glow?.style.setProperty(
						"--instant-v2-glow-y",
						`${event.clientY - (bounds.top + bounds.height / 2)}px`,
					);
				}}
			/>
			{error && (
				<p className="cli-onboarding-error" role="alert">
					Could not copy the command. Please try again.
				</p>
			)}
		</>
	);
}
