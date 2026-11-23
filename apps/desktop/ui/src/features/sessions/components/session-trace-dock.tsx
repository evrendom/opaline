import { IconArrowDown, IconArrowLeft, IconArrowUp } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "@/app/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { TouchTarget } from "@/app/ui/touch-target";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { cn } from "@/lib/utils";

function SessionTraceNavigationButton({
	disabled,
	icon,
	label,
	onClick,
}: {
	disabled: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						size="icon"
						aria-label={label}
						className="group relative"
						disabled={disabled}
						onClick={onClick}
					>
						{icon}
						<TouchTarget className="size-12" />
					</Button>
				}
			/>
			<TooltipContent side="top" sideOffset={10}>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

export function SessionTraceDock({
	navigation,
	onReturn,
	position,
	totalSessions,
}: {
	navigation: SessionNavigation;
	onReturn: () => void;
	position: number | undefined;
	totalSessions: number;
}) {
	const positionLabel =
		position === undefined || totalSessions === 0
			? "Session"
			: `${position} of ${totalSessions}`;

	return (
		<nav
			aria-label="Session controls"
			className="shell-dock-content flex min-w-0 items-center gap-xs"
		>
			<Button
				type="button"
				size="lg"
				aria-label="Back to sessions"
				className="group relative"
				onClick={onReturn}
			>
				<IconArrowLeft
					aria-hidden="true"
					className="size-4 shrink-0 transition-transform duration-(--motion-medium-duration) ease-base group-hover:-translate-x-px group-active:translate-x-0 motion-reduce:transition-none"
				/>
				<span>Back</span>
				<TouchTarget className="size-12" />
			</Button>
			<div aria-hidden="true" className="h-5 w-px shrink-0 bg-hover-strong" />
			<SessionTraceNavigationButton
				disabled={!navigation.hasPreviousSession}
				icon={
					<IconArrowUp
						aria-hidden="true"
						className="size-4 shrink-0 transition-transform duration-(--motion-medium-duration) ease-base group-hover:-translate-y-px group-active:translate-y-0 group-disabled:translate-y-0 motion-reduce:transition-none"
					/>
				}
				label="Previous session"
				onClick={navigation.onPreviousSession}
			/>
			<p
				aria-live="polite"
				className={cn(
					"min-w-16 shrink-0",
					"px-xs",
					"text-center font-mono text-body-xxl font-medium whitespace-nowrap tabular-nums",
					"text-ink-3",
					"sm:min-w-20 sm:text-body-xl",
				)}
			>
				<span className="sr-only">Session </span>
				{positionLabel}
			</p>
			<SessionTraceNavigationButton
				disabled={!navigation.hasNextSession}
				icon={
					<IconArrowDown
						aria-hidden="true"
						className="size-4 shrink-0 transition-transform duration-(--motion-medium-duration) ease-base group-hover:translate-y-px group-active:translate-y-0 group-disabled:translate-y-0 motion-reduce:transition-none"
					/>
				}
				label="Next session"
				onClick={navigation.onNextSession}
			/>
		</nav>
	);
}
