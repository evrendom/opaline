import { PreviewCard } from "@base-ui/react/preview-card";
import { IconUser } from "@tabler/icons-react";
import type { ReactElement } from "react";
import type { SessionMemberProfileSummary } from "@/features/sessions/components/session-member-profile-summary";
import { cn } from "@/lib/utils";

const SPARKLINE_WIDTH = 176;
const SPARKLINE_HEIGHT = 20;
const SPARKLINE_PADDING = 1.5;

function buildSparklinePoints(values: readonly number[]) {
	const chartValues =
		values.length === 1 ? [values[0] ?? 0, values[0] ?? 0] : values;
	const maximumValue = Math.max(...chartValues, 1);
	const drawableWidth = SPARKLINE_WIDTH - SPARKLINE_PADDING * 2;
	const drawableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;

	return chartValues
		.map((value, index) => {
			const x =
				SPARKLINE_PADDING +
				(index / Math.max(chartValues.length - 1, 1)) * drawableWidth;
			const y =
				SPARKLINE_HEIGHT -
				SPARKLINE_PADDING -
				(value / maximumValue) * drawableHeight;

			return `${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(" ");
}

function MemberActivitySparkline({ values }: { values: readonly number[] }) {
	const totalSessions = values.reduce((total, value) => total + value, 0);

	if (values.length === 0) {
		return <p className="text-base text-muted-foreground sm:text-sm">—</p>;
	}

	return (
		<svg
			aria-label={`${totalSessions.toLocaleString()} sessions across ${values.length.toLocaleString()} activity periods`}
			className="h-5 w-full overflow-visible"
			role="img"
			viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
		>
			<polyline
				className="fill-none stroke-[#266df0]"
				points={buildSparklinePoints(values)}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

function SessionMemberAvatar({
	avatarUrl,
	size,
}: {
	avatarUrl: string | undefined;
	size: "profile" | "trigger";
}) {
	const isTrigger = size === "trigger";
	const avatarClassName = cn(
		"shrink-0 rounded-full object-cover outline-1 -outline-offset-1 outline-black/5 dark:outline-white/10",
		isTrigger ? "size-4.5" : "size-6",
	);

	if (avatarUrl) {
		return (
			<img
				alt=""
				className={avatarClassName}
				height={isTrigger ? 18 : 24}
				src={avatarUrl}
				width={isTrigger ? 18 : 24}
			/>
		);
	}

	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full bg-muted outline-1 -outline-offset-1 outline-black/5 dark:outline-white/10",
				isTrigger ? "size-4.5" : "size-6",
			)}
		>
			<IconUser className="size-4 shrink-0 text-muted-foreground" />
		</span>
	);
}

export function SessionMemberProfilePreview({
	avatarUrl,
	profile,
	trigger,
	userLabel,
}: {
	avatarUrl: string | undefined;
	profile: SessionMemberProfileSummary;
	trigger?: ReactElement;
	userLabel: string;
}) {
	const activityTotal = profile.activity.reduce(
		(total, value) => total + value,
		0,
	);

	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger
				aria-label={`Session owner: ${userLabel}`}
				data-slot="session-member-profile-trigger"
				closeDelay={140}
				delay={180}
				render={
					trigger ?? (
						<span
							className="relative flex size-4.5 shrink-0 cursor-help items-center justify-center rounded-full outline-none data-popup-open:outline-2 data-popup-open:outline-offset-2 data-popup-open:outline-(--session-overview-accent)"
							data-slot="session-member-profile-trigger"
						/>
					)
				}
			>
				{trigger ? undefined : (
					<>
						<SessionMemberAvatar avatarUrl={avatarUrl} size="trigger" />
						<span className="sr-only">{userLabel}</span>
					</>
				)}
			</PreviewCard.Trigger>
			<PreviewCard.Portal>
				<PreviewCard.Positioner
					align="center"
					className="isolate z-50"
					collisionPadding={8}
					positionMethod="fixed"
					side="bottom"
					sideOffset={2}
				>
					<PreviewCard.Popup
						className="w-52 origin-(--transform-origin) rounded-lg bg-popover p-2.5 text-popover-foreground ring-1 ring-foreground/10 outline-none transition-[opacity,transform] duration-100 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0 dark:ring-foreground/15"
						data-slot="session-member-profile-preview"
					>
						<div className="flex min-w-0 items-center gap-2">
							<SessionMemberAvatar avatarUrl={avatarUrl} size="profile" />
							<p className="min-w-0 flex-1 truncate text-base font-medium sm:text-sm">
								{userLabel}
							</p>
							<p className="shrink-0 text-base text-muted-foreground tabular-nums sm:text-sm">
								{activityTotal.toLocaleString()} sessions
							</p>
						</div>
						<MemberActivitySparkline values={profile.activity} />
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	);
}
