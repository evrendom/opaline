import { IconUser } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { DashboardModelIdentity } from "@/features/dashboard/components/DashboardModelBadges";
import { cn } from "@/lib/utils";

const sessionIdentityCounterClassName = "flex shrink-0 items-start gap-m";

function SessionUserIdentity({
	displayName,
	imageUrl,
	messageCount,
}: {
	displayName: string;
	imageUrl: string | undefined;
	messageCount: number | undefined;
}) {
	const safeMessageCount = messageCount ?? 0;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<div className={cn(sessionIdentityCounterClassName, "cursor-help")}>
						{imageUrl ? (
							<img
								src={imageUrl}
								alt=""
								width={16}
								height={16}
								className="size-4 shrink-0 corner-full object-cover outline-(length:--border-m) -outline-offset-1 outline-line-faint"
							/>
						) : (
							<span className="flex size-4 shrink-0 items-center justify-center corner-full bg-field outline-(length:--border-m) -outline-offset-1 outline-line-faint">
								<IconUser className="size-3 shrink-0" />
							</span>
						)}
						<div className="shrink-0 font-mono text-body-xxl font-heavy text-dashboardy-heading tabular-nums sm:text-body-l">
							{safeMessageCount}
						</div>
					</div>
				}
			/>
			<TooltipContent>
				{displayName}: {safeMessageCount} messages
			</TooltipContent>
		</Tooltip>
	);
}

export function SessionInteractionCounts({
	className,
	model,
	modelMessageCount,
	userDisplayName,
	userImageUrl,
	userMessageCount,
}: {
	className: string;
	model: string | undefined;
	modelMessageCount: number | undefined;
	userDisplayName: string;
	userImageUrl: string | undefined;
	userMessageCount: number | undefined;
}) {
	return (
		<div className={className}>
			{model ? (
				<DashboardModelIdentity
					className={sessionIdentityCounterClassName}
					model={model}
					messageCount={modelMessageCount}
				/>
			) : null}
			<SessionUserIdentity
				displayName={userDisplayName}
				imageUrl={userImageUrl}
				messageCount={userMessageCount}
			/>
		</div>
	);
}
