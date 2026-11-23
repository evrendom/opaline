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
		return <p className="text-body-xxl text-ink-3 sm:text-body-xl">—</p>;
	}

	return (
		<svg
			aria-label={`${totalSessions.toLocaleString()} sessions across ${values.length.toLocaleString()} activity periods`}
			className="h-5 w-full overflow-visible"
			role="img"
			viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
		>
			<polyline
				className="fill-none stroke-accent"
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
		"shrink-0 corner-full object-cover outline-(length:--border-m) -outline-offset-1 outline-line-soft",
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
				"flex shrink-0 items-center justify-center",
				"corner-full",
				"bg-field -outline-offset-1 outline-line-soft",
				"outline-(length:--border-m)",
				isTrigger ? "size-4.5" : "size-6",
			)}
		>
			<IconUser className="size-4 shrink-0 text-ink-3" />
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
							skullet-block=""
							className="relative flex size-4.5 shrink-0 cursor-help items-center justify-center corner-full outline-none data-popup-open:outline-(length:--border-l) data-popup-open:outline-offset-2 data-popup-open:outline-accent"
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
						className="w-52 origin-(--transform-origin) corner-m bg-surface p-l text-ink ring-1 ring-line outline-none transition-[opacity,transform] duration-(--motion-quick-duration) data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0"
						data-slot="session-member-profile-preview"
					>
						<div className="flex min-w-0 items-center gap-m">
							<SessionMemberAvatar avatarUrl={avatarUrl} size="profile" />
							<p className="min-w-0 flex-1 truncate text-body-xxl font-medium sm:text-body-xl">
								{userLabel}
							</p>
							<p className="shrink-0 text-body-xxl text-ink-3 tabular-nums sm:text-body-xl">
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
