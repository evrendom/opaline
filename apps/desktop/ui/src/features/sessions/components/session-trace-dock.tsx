import { IconArrowDown, IconArrowLeft, IconArrowUp } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { TouchTarget } from "@/app/ui/touch-target";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { cn } from "@/lib/utils";

const sessionTraceDockPressClassName =
	// design-escape-ok(motion): no role renders this; ease-out
	"scale-100 transition-transform duration-(--motion-duration) ease-out active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100";

const sessionTraceDockButtonClassName = cn(
	// design-escape-ok(opacity): no role renders this; dark:hover:bg-ink/6
	"group relative flex size-9 shrink-0 items-center justify-center corner-zero text-ink focus-outline hover:bg-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:active:scale-100 dark:hover:bg-ink/6",
	sessionTraceDockPressClassName,
);

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
					<button
						type="button"
						aria-label={label}
						className={sessionTraceDockButtonClassName}
						disabled={disabled}
						onClick={onClick}
					>
						{icon}
						<TouchTarget className="size-12" />
					</button>
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
			<button
				type="button"
				aria-label="Back to sessions"
				className={cn(
					"group relative flex h-9 shrink-0 items-center gap-s",
					"corner-zero pl-m pr-l",
					"text-body-xxl font-medium",
					"text-ink focus-outline",
					// design-escape-ok(opacity): no role renders this; dark:hover:bg-ink/6
					"hover:bg-hover dark:hover:bg-ink/6 sm:text-body-xl",
					sessionTraceDockPressClassName,
				)}
				onClick={onReturn}
			>
				<IconArrowLeft
					aria-hidden="true"
					// design-escape-ok(motion): no role renders this; ease-out
					className="size-4 shrink-0 transition-transform duration-(--motion-medium-duration) ease-out group-hover:-translate-x-px group-active:translate-x-0 motion-reduce:transition-none"
				/>
				<span>Back</span>
				<TouchTarget className="size-12" />
			</button>
			<div aria-hidden="true" className="h-5 w-px shrink-0 bg-hover-strong" />
			<SessionTraceNavigationButton
				disabled={!navigation.hasPreviousSession}
				icon={
					<IconArrowUp
						aria-hidden="true"
						// design-escape-ok(motion): no role renders this; ease-out
						className="size-4 shrink-0 transition-transform duration-(--motion-medium-duration) ease-out group-hover:-translate-y-px group-active:translate-y-0 group-disabled:translate-y-0 motion-reduce:transition-none"
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
						// design-escape-ok(motion): no role renders this; ease-out
						className="size-4 shrink-0 transition-transform duration-(--motion-medium-duration) ease-out group-hover:translate-y-px group-active:translate-y-0 group-disabled:translate-y-0 motion-reduce:transition-none"
					/>
				}
				label="Next session"
				onClick={navigation.onNextSession}
			/>
		</nav>
	);
}
