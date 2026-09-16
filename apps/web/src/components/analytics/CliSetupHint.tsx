import { cn } from "@/lib/utils";
import { type CliSetupStepId, cliSetupCommands } from "./cli-setup-commands";

export { cliSetupCommands };
export type { CliSetupStepId };

export function CliSetupHint({
	completedStepIds = [],
}: {
	completedStepIds?: readonly CliSetupStepId[];
}) {
	const completedSteps = new Set(completedStepIds);
	return (
		<div className="mt-4 mx-auto grid w-full max-w-xl gap-3">
			{cliSetupCommands.map((step) => (
				<DefaultCliSetupCommand
					key={step.command}
					label={step.title}
					command={step.command}
					isComplete={completedSteps.has(step.id)}
				/>
			))}
		</div>
	);
}

function DefaultCliSetupCommand(props: {
	command: string;
	isComplete: boolean;
	label: string;
}) {
	const { command, isComplete, label } = props;

	return (
		<div
			data-complete={isComplete ? "true" : "false"}
			className={cn(
				"rounded-[1.75rem] border border-border/60 bg-card px-5 py-5 shadow-none transition-colors",
				isComplete
					? "border-status-success-border bg-status-success-bg text-status-success-text"
					: null,
			)}
		>
			<p
				className={cn(
					"[font-family:var(--app-font-heading)] text-lg font-extrabold tracking-[-0.02em] text-foreground transition-colors",
					isComplete ? "text-status-success-text" : null,
				)}
			>
				{label}
			</p>
			<code
				className={cn(
					"mt-4 block rounded-2xl border border-border/60 bg-background px-3 py-3 font-mono text-[13px] text-foreground transition-colors",
					isComplete
						? "border-status-success-border bg-status-success-bg text-status-success-text"
						: null,
				)}
			>
				{command}
			</code>
		</div>
	);
}
